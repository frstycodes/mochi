import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, it, vi } from '@effect/vitest';
import { Context, Effect, Fiber, Layer, Option, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import WebSocket, { WebSocketServer } from 'ws';
import { Capabilities as Contract } from '@mochi/schema';
import type { BrowserSnapshot } from '@mochi/domain/host/types/browser';
import type {
  ApprovalRequest,
  RemoteStatus,
} from '../../../../apps/desktop/src/host/types/remote.ts';
import { HEARTBEAT, isId } from '../../../../infra/relay/src/protocol.ts';
import type { StoredRecord } from '../../../../infra/relay/src/protocol.ts';
import {
  Relay,
  type Attachment,
  type MachineRecord,
  type Room,
} from '../../../../infra/relay/src/relay.ts';

// `mochi serve` on a computer with no screen joins your computers end to end: a device-code sign-in at a fake Clerk, the
// real relay logic behind Node's http and `ws`, and a second Core, the computer you approve it on.

const TOKEN = 'e2e-serve-token';
const USER = { sub: 'user_ada', name: 'Ada', email: 'ada@example.com' };

/** Clerk as far as `mochi login` and the relay go: the device grant, refreshes, and userinfo. Every access token is Ada's. */
async function startClerk() {
  const issued = new Set<string>();
  let n = 0;
  const server = createServer(async (req, res) => {
    const body = new URLSearchParams(await text(req));
    const send = json(res);
    switch (new URL(req.url ?? '/', 'http://x').pathname) {
      case '/.well-known/oauth-authorization-server':
        return send(200, {
          issuer,
          token_endpoint: `${issuer}/oauth/token`,
          device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
        });
      case '/oauth/device_authorization':
        return send(200, {
          device_code: `device-${++n}`,
          user_code: 'WDJB-MJHT',
          verification_uri: `${issuer}/device`,
          expires_in: 600,
          interval: 1,
        });
      case '/oauth/token': {
        const access = `access-${++n}`;
        issued.add(access);
        return send(200, {
          access_token: access,
          expires_in: 3600,
          ...(body.get('grant_type') !== 'refresh_token' && {
            refresh_token: `refresh-${n}`,
          }),
        });
      }
      case '/oauth/userinfo':
        return issued.has(bearer(req) ?? '') ? send(200, USER) : send(401, {});
      default:
        return send(404, {});
    }
  });
  const port = await listen(server);
  const issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    userOf: (token: string | undefined) =>
      token && issued.has(token) ? USER.sub : undefined,
    close: () => server.close(),
  };
}

/** One account's sockets and storage, in memory: the Durable Object `infra/relay/src/index.ts` runs `Relay` in. */
function memoryRoom() {
  const sockets = new Map<
    WebSocket,
    { tags: string[]; attachment: Attachment; isClosed: boolean }
  >();
  let machines: Record<string, MachineRecord> = {};
  let records: Record<string, StoredRecord> = {};
  const waiters = new Set<() => void>();
  /** Once `count` machines registered, their names sealed: the relay lists them, and can't read what they're called. */
  const registered = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (Object.values(machines).filter((m) => m.sealed).length < count)
          return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });
  const room: Room<WebSocket> = {
    byTag: (tag) =>
      [...sockets]
        .filter(([, s]) => !s.isClosed && s.tags.includes(tag))
        .map(([socket]) => socket),
    attachment: (socket) => sockets.get(socket)!.attachment,
    send: (socket, data) => socket.send(data),
    close: (socket, code, reason) => {
      const held = sockets.get(socket);
      if (held) held.isClosed = true;
      socket.close(code, reason);
    },
    machines: async () => machines,
    saveMachines: async (next) => {
      machines = next;
      for (const waiter of waiters) waiter();
    },
    records: async () => records,
    saveRecords: async (next) => void (records = next),
  };
  return {
    room,
    sockets,
    registered,
    stored: () => ({ machines, records }),
  };
}

/** The relay's routes over `Relay`, as the Worker serves them, with Clerk's JWT check swapped for the fake's tokens. */
async function startRelay(
  userOf: (token: string | undefined) => string | undefined,
) {
  const accounts = new Map<
    string,
    ReturnType<typeof memoryRoom> & { relay: Relay<WebSocket> }
  >();
  const accountOf = (user: string) => {
    let account = accounts.get(user);
    if (!account) {
      const memory = memoryRoom();
      accounts.set(
        user,
        (account = { ...memory, relay: new Relay(memory.room) }),
      );
    }
    return account;
  };
  const server = createServer(async (req, res) => {
    const user = userOf(bearer(req));
    const send = json(res);
    if (!user) return send(401, 'Sign in to Mochi first');
    const { relay } = accountOf(user);
    const url = new URL(req.url ?? '/', 'http://relay');
    const machinePath = /^\/v1\/machines\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === '/v1/machines' && req.method === 'GET')
      return send(200, await relay.list());
    if (machinePath && req.method === 'DELETE' && isId(machinePath[1])) {
      await relay.remove(machinePath[1]);
      return res.writeHead(204).end();
    }
    if (url.pathname === '/v1/members' && req.method === 'GET')
      return send(200, await relay.members());
    if (url.pathname === '/v1/members' && req.method === 'POST') {
      await relay.addMembers(JSON.parse(await text(req)));
      return res.writeHead(204).end();
    }
    return send(404, 'Not found');
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: number) =>
      socket.end(`HTTP/1.1 ${status} Refused\r\nContent-Length: 0\r\n\r\n`);
    const user = userOf(bearer(req));
    if (!user) return refuse(401);
    const { relay, sockets } = accountOf(user);
    const params = new URL(req.url ?? '/', 'http://relay').searchParams;
    const machine = params.get('machine');
    const device = params.get('device');
    const role = params.get('role');
    if (!isId(machine) || (role === 'device' && !isId(device)))
      return refuse(400);
    const admission =
      role === 'machine'
        ? relay.admit('machine', machine)
        : relay.admit('device', machine, device!);
    if ('refusal' in admission)
      return refuse(admission.code === 4404 ? 404 : 400);
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, { ...admission, isClosed: false });
      // In order, as the Durable Object's input gate delivers them.
      let delivered = Promise.resolve();
      ws.on('message', (data: Buffer, isBinary) => {
        // The runtime's auto-response: the relay never sees heartbeats.
        if (!isBinary && data.toString() === HEARTBEAT.ping)
          return ws.send(HEARTBEAT.pong);
        const frame = isBinary
          ? (data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            ) as ArrayBuffer)
          : data.toString();
        delivered = delivered.then(() => relay.message(ws, frame));
      });
      ws.on('close', () => {
        sockets.get(ws)!.isClosed = true;
        relay.closed(ws);
        sockets.delete(ws);
      });
      relay.opened(ws);
    });
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    registered: (user: string, count: number) =>
      accountOf(user).registered(count),
    /** Everything the relay stores for `user`, as it would persist it. */
    stored: (user: string) => accountOf(user).stored(),
    close() {
      for (const client of wss.clients) client.terminate();
      server.closeAllConnections();
      server.close();
    },
  };
}

const text = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
const json = (res: ServerResponse) => (status: number, value: unknown) =>
  void res
    .writeHead(status, { 'content-type': 'application/json' })
    .end(JSON.stringify(value));
const bearer = (req: IncomingMessage) =>
  /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );

let clerk: Awaited<ReturnType<typeof startClerk>>;
let relay: Awaited<ReturnType<typeof startRelay>>;
let core: typeof import('../server.ts');
let client: typeof import('../client.ts');
let hostClient: typeof import('../hostClient.ts');
let login: typeof import('./login.ts');
let browser: typeof import('../browser/headless.ts');

beforeAll(async () => {
  clerk = await startClerk();
  relay = await startRelay(clerk.userOf);
  // Each is read once, when its module loads.
  process.env.MOCHI_CLERK_ISSUER = clerk.issuer;
  process.env.MOCHI_CLERK_CLIENT_ID = 'mochi-e2e';
  process.env.MOCHI_RELAY_URL = relay.url;
  [core, client, hostClient, login, browser] = await Promise.all([
    import('../server.ts'),
    import('../client.ts'),
    import('../hostClient.ts'),
    import('./login.ts'),
    import('../browser/headless.ts'),
  ]);
});
afterAll(() => {
  delete process.env.MOCHI_CLERK_ISSUER;
  delete process.env.MOCHI_CLERK_CLIENT_ID;
  delete process.env.MOCHI_RELAY_URL;
  relay?.close();
  clerk?.close();
});

const scratch = (name: string) =>
  mkdtempSync(path.join(tmpdir(), `mochi-e2e-${name}-`));
const noWait = async () => {};

/** A Core on `userData`, and a host caller over the serve token. */
const startCore = (options: {
  userData: string;
  serving?: (line: string) => void;
  browserView?: ReturnType<typeof browser.headlessBrowser>;
}) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      core.layerCore({
        port: 0,
        tokens: new Map([[TOKEN, Contract.allScopes]]),
        origins: [],
        remotePort: 0,
        ...options,
      }),
    );
    const { port } = Context.get(context, HttpServer.HttpServer).address as {
      port: number;
    };
    const connection = yield* client.makeCoreClient(
      client.coreUrl(port, TOKEN),
    );
    const call = hostClient.makeHostCaller(connection);
    return {
      port,
      connection,
      host: <A = unknown>(tag: string, ...args: unknown[]) =>
        Effect.promise(() => call(tag, args) as Promise<A>),
    };
  });

const PAGE = `<!doctype html><title>Served alone</title><h1 id="greeting">Hello from Chromium</h1>`;

/** A local page to drive, closed with the scope. */
const servePage = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = createServer((_req, res) =>
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE),
    );
    return {
      url: `http://127.0.0.1:${await listen(server)}/`,
      close: () => server.close(),
    };
  }),
  ({ close }) => Effect.sync(close),
);

/** The headless Chromium this Playwright wants, if it's installed here; the test never downloads one. */
const installedChromium = async () => {
  const { registry } = await import('playwright-core/lib/coreBundle');
  const executable = registry.registry
    .findExecutable('chromium-headless-shell')
    ?.executablePath('javascript');
  return !!executable && existsSync(executable);
};

it.live(
  'mochi serve with no screen: mochi login signs in by code, another computer approves it with the code it printed, and both trust each other',
  () =>
    Effect.gen(function* () {
      // The computer you approve on: signed in, reachable through the relay, with an interface (main) to show the prompt.
      const studioData = scratch('studio');
      yield* login.signInWithCode(
        login.terminalAccount(studioData, clerk.issuer),
        noWait,
      );
      const studio = yield* startCore({ userData: studioData });
      yield* hostClient
        .serveCapabilities(
          studio.connection,
          ['remote', 'main'],
          async () => null,
        )
        .pipe(Effect.forkChild);
      const prompt = yield* studio.connection.agentPush().pipe(
        Stream.filter(({ channel }) => channel === 'remote:onApproval'),
        Stream.map(({ payload }) => payload as ApprovalRequest),
        Stream.runHead,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* studio.host('remote.set', {
        isEnabled: true,
        reachesAnywhere: true,
        machineName: 'Studio',
      });
      yield* Effect.promise(() => relay.registered(USER.sub, 1));

      // `mochi serve`: named Pi, not signed in yet, so it waits.
      const piData = scratch('pi');
      writeFileSync(
        path.join(piData, 'remote.json'),
        JSON.stringify({ machineName: 'Pi' }),
      );
      const lines: string[] = [];
      const pi = yield* startCore({
        userData: piData,
        serving: (line) => lines.push(line),
        browserView: browser.headlessBrowser(
          browser.chromiumLauncher(undefined),
        ),
      });
      assert.equal(
        (yield* pi.host<RemoteStatus>('remote.status')).settings.isEnabled,
        false,
      );

      // You approve on Studio once its prompt shows the code Pi printed.
      const approved = yield* Fiber.join(prompt).pipe(
        Effect.map(Option.getOrThrow),
        Effect.tap(({ id }) => studio.host('remote.answerApproval', id, true)),
        Effect.forkChild,
      );

      // `mochi login` in another shell: the code sign-in into Pi's data folder, then the join through the running serve.
      writeFileSync(
        login.serveFile(piData),
        JSON.stringify({
          pid: process.pid,
          url: client.coreUrl(pi.port, '').split('#')[0],
          token: TOKEN,
        }),
      );
      const printed: string[] = [];
      const log = vi
        .spyOn(console, 'log')
        .mockImplementation((line: unknown) => void printed.push(String(line)));
      yield* login
        .signInWithCode(login.terminalAccount(piData, clerk.issuer), noWait)
        .pipe(
          Effect.andThen(login.joinThroughServe(piData)),
          Effect.ensuring(Effect.sync(() => log.mockRestore())),
        );

      const asked = printed.find((line) => line.startsWith('Approve'));
      // Studio's name is sealed to its members, which Pi isn't yet: Pi names it by the code.
      const code = /^Approve “Pi” on Computer (\d{3} \d{3}): \1$/.exec(
        asked ?? '',
      )?.[1];
      assert.ok(code, printed.join('\n'));
      const request = yield* Fiber.join(approved);
      assert.equal(request.name, 'Pi');
      assert.equal(request.pairingCode, code);
      assert.equal(
        printed.at(-1),
        'Joined your computers: Studio allowed this one.',
      );
      // `mochi serve`'s own output says the same.
      assert.match(
        lines[0] ?? '',
        /^Remote access is on, through the relay as “Pi”/,
      );
      assert.ok(lines.includes(asked!), lines.join('\n'));
      assert.equal(
        lines.at(-1),
        'Joined your computers: Studio allowed this one.',
      );

      // Each lists the other as a member.
      const names = (status: RemoteStatus) => status.members.map((m) => m.name);
      assert.deepEqual(
        names(yield* studio.host<RemoteStatus>('remote.status')),
        ['Pi'],
      );
      // Pi is on the relay too, for your devices to reach.
      yield* Effect.promise(() => relay.registered(USER.sub, 2));
      // Nothing the relay keeps names either computer.
      assert.doesNotMatch(
        JSON.stringify(relay.stored(USER.sub)),
        /Studio|"Pi"|"name"/,
      );
      const piStatus = yield* pi.host<RemoteStatus>('remote.status');
      assert.deepEqual(names(piStatus), ['Studio']);
      assert.equal(piStatus.settings.reachesAnywhere, true);

      // Asked again, it already is one.
      const again = yield* pi.connection['remote.joinAlone']().pipe(
        Stream.runCollect,
      );
      assert.deepEqual([...again], [{ type: 'member' }]);

      // A setting changed over the serve token is read back.
      const before = yield* pi.host<{ concurrency: number }>('settings.get');
      yield* pi.host('settings.set', { concurrency: before.concurrency + 1 });
      assert.equal(
        (yield* pi.host<{ concurrency: number }>('settings.get')).concurrency,
        before.concurrency + 1,
      );

      // Agents on it drive headless Chromium, Core's own `browserView`.
      if (!(yield* Effect.promise(installedChromium)))
        return console.warn(
          'Skipped the browser: no headless Chromium installed (pnpm -F @mochi/core exec playwright-core install chromium-headless-shell)',
        );
      const { url } = yield* servePage;
      const { id } = yield* pi.host<{ id: string }>('browser.create', {
        url,
        spaceId: 'test',
      });
      const snapshot = yield* pi.host<BrowserSnapshot>('browser.snapshot', id);
      assert.match(snapshot.text, /heading "Hello from Chromium"/);
      // As JSON, the way an agent reads it.
      const read = yield* pi.host<{ value: string }>(
        'browser.eval',
        id,
        '[document.title, document.getElementById("greeting").textContent]',
      );
      assert.deepEqual(JSON.parse(read.value), [
        'Served alone',
        'Hello from Chromium',
      ]);
      yield* pi.host('browser.destroy', id);
    }).pipe(Effect.scoped),
  60_000,
);
