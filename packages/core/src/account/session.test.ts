import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { fileKeys } from '../keys/keyStore.ts';
import { signInWithCode, signOut, terminalAccount } from '../serve/login.ts';
import { NO_DEVICE_SIGN_IN } from './deviceCode.ts';
import { legacySession } from './service.ts';
import { ACCOUNT_KEY } from './session.ts';

type Poll =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'ok';

/** Clerk as far as the device grant goes: metadata, the code, the token endpoint answering `polls` in turn, userinfo, revoke. */
const mockClerk = (
  polls: Poll[],
  options: { hasDeviceGrant?: boolean; network?: { isDown: boolean } } = {},
) =>
  Effect.acquireRelease(
    Effect.promise(() => startClerk(polls, options)),
    ({ close }) => Effect.sync(close),
  );

async function startClerk(
  polls: Poll[],
  {
    hasDeviceGrant = true,
    network,
  }: { hasDeviceGrant?: boolean; network?: { isDown: boolean } } = {},
) {
  const seen: { path: string; body: URLSearchParams }[] = [];
  const server = createServer(async (req, res) => {
    // No network: the connection dies with no answer, and fetch rejects as it does offline.
    if (network?.isDown) return void req.socket.destroy();
    const body = new URLSearchParams(await text(req));
    const url = new URL(req.url ?? '/', 'http://x');
    seen.push({ path: url.pathname, body });
    const send = (status: number, value: unknown) =>
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(value));
    switch (url.pathname) {
      case '/.well-known/oauth-authorization-server':
        return send(200, {
          issuer,
          token_endpoint: `${issuer}/oauth/token`,
          ...(hasDeviceGrant && {
            device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
          }),
        });
      case '/oauth/device_authorization':
        return send(200, {
          device_code: 'device-1',
          user_code: 'WDJB-MJHT',
          verification_uri: `${issuer}/device`,
          verification_uri_complete: `${issuer}/device?user_code=WDJB-MJHT`,
          expires_in: 600,
          interval: 2,
        });
      case '/oauth/token': {
        if (body.get('grant_type') === 'refresh_token')
          return send(200, { access_token: 'access-2', expires_in: 3600 });
        const next = polls.shift() ?? 'ok';
        return next === 'ok'
          ? send(200, {
              access_token: 'access-1',
              refresh_token: 'refresh-1',
              expires_in: 86400,
            })
          : send(400, { error: next });
      }
      case '/oauth/userinfo':
        return req.headers.authorization === 'Bearer access-1'
          ? send(200, { sub: 'user_1', name: 'Ada', email: 'ada@example.com' })
          : send(401, {});
      case '/oauth/token/revoke':
        return send(200, {});
      default:
        return send(404, {});
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { issuer, seen, close: () => server.close() };
}

const text = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

const scratch = () => mkdtempSync(path.join(tmpdir(), 'mochi-account-'));
const plainKeys = (data: string) =>
  fileKeys(data, {
    isAvailable: () => false,
    seal: async () => '',
    open: async () => '',
  });

/** Records each wait instead of sleeping. */
const waits = () => {
  const ms: number[] = [];
  return { ms, wait: async (wait: number) => void ms.push(wait) };
};

const promise = <A>(run: () => Promise<A>) => Effect.promise(run);

it.live(
  'mochi login: the code is shown, pending and slow_down are honoured, and the session lands in Keys',
  () =>
    Effect.gen(function* () {
      const clerk = yield* mockClerk([
        'authorization_pending',
        'slow_down',
        'ok',
      ]);
      const data = scratch();
      const { ms, wait } = waits();
      const account = yield* signInWithCode(
        terminalAccount(data, clerk.issuer),
        wait,
      );
      assert.equal(account.status, 'signed-in');
      assert.equal(account.user?.email, 'ada@example.com');
      // The interval Clerk gave, then five seconds more after slow_down.
      assert.deepEqual(ms, [2000, 2000, 7000]);
      const issued = clerk.seen.find(
        (r) => r.path === '/oauth/device_authorization',
      )!;
      assert.equal(
        issued.body.get('scope'),
        'openid profile email offline_access',
      );
      assert.equal(issued.body.has('client_secret'), false);
      const polled = clerk.seen.filter((r) => r.path === '/oauth/token');
      assert.equal(
        polled[0]!.body.get('grant_type'),
        'urn:ietf:params:oauth:grant-type:device_code',
      );
      assert.equal(polled[0]!.body.get('device_code'), 'device-1');
      const saved = yield* promise(() => plainKeys(data).get(ACCOUNT_KEY));
      assert.deepEqual(JSON.parse(saved!), {
        user: {
          id: 'user_1',
          name: 'Ada',
          email: 'ada@example.com',
          imageUrl: null,
        },
        refreshToken: 'refresh-1',
      });
    }),
);

it.live.each([
  ['access_denied', /denied/],
  ['expired_token', /expired/],
] as const)(
  'mochi login: %s ends sign-in with nothing saved',
  ([poll, message]) =>
    Effect.gen(function* () {
      const clerk = yield* mockClerk(['authorization_pending', poll]);
      const data = scratch();
      const failure = yield* Effect.flip(
        signInWithCode(terminalAccount(data, clerk.issuer), waits().wait),
      );
      assert.match(failure.message, message);
      assert.equal(
        yield* promise(() => plainKeys(data).get(ACCOUNT_KEY)),
        undefined,
      );
      const after = yield* promise(() =>
        terminalAccount(data, clerk.issuer).current(),
      );
      assert.equal(after.status, 'signed-out');
    }),
);

it.live('a Clerk app without the device grant says so', () =>
  Effect.gen(function* () {
    const clerk = yield* mockClerk([], { hasDeviceGrant: false });
    const failure = yield* Effect.flip(
      signInWithCode(terminalAccount(scratch(), clerk.issuer), waits().wait),
    );
    assert.equal(failure.message, NO_DEVICE_SIGN_IN);
  }),
);

it.live('mochi logout revokes the refresh token and clears Keys', () =>
  Effect.gen(function* () {
    const clerk = yield* mockClerk(['ok']);
    const data = scratch();
    const account = terminalAccount(data, clerk.issuer);
    yield* signInWithCode(account, waits().wait);
    yield* signOut(account, data);
    const revoke = clerk.seen.find((r) => r.path === '/oauth/token/revoke');
    assert.equal(revoke?.body.get('token'), 'refresh-1');
    assert.equal(
      yield* promise(() => plainKeys(data).get(ACCOUNT_KEY)),
      undefined,
    );
    assert.equal(
      (yield* promise(() => account.current())).status,
      'signed-out',
    );
  }),
);

it.live('a running Core sees a login made in another process', () =>
  Effect.gen(function* () {
    const clerk = yield* mockClerk(['ok']);
    const data = scratch();
    const running = terminalAccount(data, clerk.issuer);
    assert.equal(
      (yield* promise(() => running.current())).status,
      'signed-out',
    );
    yield* signInWithCode(terminalAccount(data, clerk.issuer), waits().wait);
    assert.equal((yield* promise(() => running.current())).status, 'signed-in');
    // Its access token comes from the saved refresh token.
    assert.equal(yield* promise(() => running.accessToken()), 'access-2');
  }),
);

it.live(
  "main's safeStorage session moves into Keys once, so desktop users stay signed in",
  () =>
    Effect.gen(function* () {
      const data = scratch();
      const user = { id: 'user_1', name: 'Ada', email: null, imageUrl: null };
      writeFileSync(
        path.join(data, 'account.json'),
        JSON.stringify({ user, refreshToken: 'c2VhbGVk' }),
      );
      const moved = yield* promise(() =>
        legacySession(data, async (sealed) => `opened:${sealed}`),
      );
      assert.deepEqual(moved, { user, refreshToken: 'opened:c2VhbGVk' });
      const again = yield* promise(() => legacySession(data, async () => ''));
      assert.equal(again, undefined);
    }),
);

it.live(
  'a refresh that fails because the network is down keeps the session, and the next one online succeeds',
  () =>
    Effect.gen(function* () {
      const network = { isDown: false };
      const clerk = yield* mockClerk(['ok'], { network });
      const data = scratch();
      const account = terminalAccount(data, clerk.issuer);
      yield* signInWithCode(terminalAccount(data, clerk.issuer), waits().wait);
      network.isDown = true;
      const offline = yield* promise(() =>
        account.accessToken().then(
          () => 'resolved',
          (e: unknown) => String(e),
        ),
      );
      assert.match(offline, /fetch failed/);
      assert.equal(
        (yield* promise(() => account.current())).status,
        'signed-in',
      );
      network.isDown = false;
      assert.equal(yield* promise(() => account.accessToken()), 'access-2');
    }),
);
