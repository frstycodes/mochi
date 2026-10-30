import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Config, Console, Data, Effect, Layer, Stream } from 'effect';
import { Socket } from 'effect/socket';
import WebSocket from 'ws';
import { Command, Flag } from 'effect/cli';
import type { MochiAccount } from '@mochi/domain/host/types/account';
import { CLERK, makeAccount, type Account } from '../account/session.ts';
import { fileKeys } from '../keys/keyStore.ts';
import { makeCoreClient } from '../client.ts';
import { forgetMachineAtRelay } from '../remote/relayClient.ts';
import { describeJoin, type JoinProgress } from '../remote/service.ts';

/** The data folder every `mochi` command works in: `mochi login` signs in the Core `mochi serve` runs there. */
export const dataFlag = Flag.String('data').pipe(
  Flag.withDescription(
    'Data folder; the desktop app’s works while the app is closed',
  ),
  Flag.withFallbackConfig(Config.NonEmptyString('MOCHI_CORE_DATA')),
  Flag.withDefault(path.join(homedir(), '.mochi', 'serve')),
);

/** Why `mochi login` didn't sign in. */
export class LoginFailed extends Data.TaggedError('LoginFailed')<{
  readonly message: string;
}> {}

/** The account as a terminal sees it: kept in the data folder's `Keys`, with no keychain and no browser to open. */
export const terminalAccount = (data: string, issuer = CLERK.issuer) =>
  makeAccount({
    keys: fileKeys(data, {
      isAvailable: () => false,
      seal: async () => '',
      open: async () => '',
    }),
    issuer,
    clientId: CLERK.clientId,
    openUrl: async () => {
      throw new Error('No browser here: use the code');
    },
  });

const who = (account: MochiAccount) => {
  const { name, email, id } = account.user ?? { id: 'unknown' };
  return name && email ? `${name} <${email}>` : (name ?? email ?? id);
};

/** The device-code sign-in, printing the code and the page to type it on. */
export const signInWithCode = (
  account: Account,
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>,
) =>
  Effect.gen(function* () {
    const signedIn = yield* Effect.tryPromise({
      try: () =>
        account.signInWithCode((code) => {
          console.log(
            `\nOpen ${code.verificationUri} in any browser and enter ${code.userCode}`,
          );
          if (code.verificationUriComplete)
            console.log(
              `(or open ${code.verificationUriComplete}, the code filled in)`,
            );
          console.log('Waiting for you to approve it…');
        }, wait),
      catch: (error) =>
        new LoginFailed({
          message: error instanceof Error ? error.message : String(error),
        }),
    });
    yield* Console.log(`Signed in as ${who(signedIn)}.`);
    return signedIn;
  });

/**
 * Where a running `mochi serve` tells `mochi login` how to reach it: its pid, socket URL, token, and under TLS its
 * certificate's path; 0600 like `keys.json` beside it.
 */
export const serveFile = (data: string) => path.join(data, 'serve.json');

/** The `mochi serve` running on `data`, if any. */
async function runningServe(data: string) {
  const text = await readFile(serveFile(data), 'utf8').catch(() => undefined);
  if (!text) return undefined;
  try {
    const found = JSON.parse(text) as {
      pid?: unknown;
      url?: unknown;
      token?: unknown;
      certFile?: unknown;
    };
    if (
      typeof found.pid !== 'number' ||
      typeof found.url !== 'string' ||
      typeof found.token !== 'string'
    )
      return undefined;
    process.kill(found.pid, 0);
    return {
      url: found.url,
      token: found.token,
      ...(typeof found.certFile === 'string' && {
        ca: await readFile(found.certFile),
      }),
    };
  } catch {
    return undefined;
  }
}

/** A WebSocket that trusts only `ca`, a TLS Core's own certificate, whatever name it was dialed by (as `remote/tunnel.ts`). */
const pinnedWebSocket = (ca: Buffer) =>
  Layer.succeed(Socket.WebSocketConstructor)(
    (address, options) =>
      new WebSocket(
        address,
        Array.isArray(options) || typeof options === 'string'
          ? options
          : options?.protocols,
        {
          ca,
          // Node's TLS reads a returned value as the error (`tls.checkServerIdentity`); ws types it as a boolean.
          checkServerIdentity: (() => undefined) as unknown as () => boolean,
        },
      ) as unknown as Socket.WebSocketLike,
  );

/**
 * After signing in: the `mochi serve` on this data folder turns on remote access and asks your online computers to let this
 * one join; this prints each code and waits until one allows it. With none running, says to start one.
 */
export const joinThroughServe = (data: string) =>
  Effect.gen(function* () {
    const serve = yield* Effect.promise(() => runningServe(data));
    if (!serve)
      return yield* Console.log(
        'Run `mochi serve` here: it turns on remote access and asks one of your other computers to let this one join.',
      );
    yield* Console.log(
      'Asking your other computers to let this one join. Approve it on one of them:',
    );
    const client = yield* makeCoreClient(
      `${serve.url}#${serve.token}`,
      serve.ca && pinnedWebSocket(serve.ca),
    );
    let last: JoinProgress | undefined;
    yield* client['remote.joinAlone']().pipe(
      Stream.runForEach((progress) =>
        Effect.sync(() => {
          last = progress;
          console.log(describeJoin(progress));
        }),
      ),
      Effect.mapError((error) => new LoginFailed({ message: String(error) })),
    );
    if (last?.type === 'failed')
      return yield* new LoginFailed({ message: last.reason });
  }).pipe(Effect.scoped);

/**
 * Signs out: removes this machine from the relay while the session can still reach it, then forgets the session here and
 * revokes it at Clerk.
 */
export const signOut = (account: Account, data: string) =>
  Effect.gen(function* () {
    const before = yield* Effect.promise(() => account.current());
    if (before.status !== 'signed-in')
      return yield* Console.log('Not signed in.');
    const machineId = yield* Effect.promise(() => machineIdIn(data));
    if (machineId)
      yield* Effect.promise(() =>
        account
          .accessToken()
          .then((token) => forgetMachineAtRelay(token, machineId))
          .catch((error: unknown) =>
            console.warn(
              `Couldn't remove this computer from the relay: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ),
      );
    const { revoked } = yield* Effect.promise(() => account.signOut());
    yield* Effect.promise(() => revoked);
    yield* Console.log(`Signed out ${who(before)}.`);
  });

/** The id this machine registers at the relay under, when remote access ever gave it one (`devices.json`). */
async function machineIdIn(data: string) {
  const text = await readFile(path.join(data, 'devices.json'), 'utf8').catch(
    () => undefined,
  );
  try {
    const id = text && (JSON.parse(text) as { machineId?: unknown }).machineId;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** `mochi serve`'s first start with no session: offers to sign in at a terminal, else says how. */
export const offerLogin = (data: string) =>
  Effect.gen(function* () {
    const account = terminalAccount(data);
    if (
      (yield* Effect.promise(() => account.current())).status !== 'signed-out'
    )
      return;
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      return yield* Console.log(
        'Not signed in to a Mochi account: run `mochi login` to join your other computers.',
      );
    const answer = yield* Effect.promise(async () => {
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return await prompt.question(
          'Sign in to your Mochi account to join your other computers? (y/N) ',
        );
      } finally {
        prompt.close();
      }
    });
    if (!/^y(es)?$/i.test(answer.trim()))
      return yield* Console.log('Skipped. Run `mochi login` any time.');
    yield* signInWithCode(account).pipe(
      Effect.catch(({ message }) =>
        Console.error(`${message}. Starting without an account.`),
      ),
    );
  });

export const login = Command.make('login', { data: dataFlag }, ({ data }) =>
  signInWithCode(terminalAccount(data)).pipe(
    Effect.andThen(joinThroughServe(data)),
  ),
).pipe(
  Command.withDescription(
    'Sign in to your Mochi account with a code you approve in any browser',
  ),
);

export const logout = Command.make('logout', { data: dataFlag }, ({ data }) =>
  signOut(terminalAccount(data), data),
).pipe(
  Command.withDescription(
    'Sign out of your Mochi account and remove this computer from the relay',
  ),
);
