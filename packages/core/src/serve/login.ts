import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Config, Console, Data, Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import type { MochiAccount } from '@mochi/domain/host/types/account';
import { CLERK, makeAccount, type Account } from '../account/session.ts';
import { fileKeys } from '../keys/keyStore.ts';
import { forgetMachineAtRelay } from '../remote/relayClient.ts';

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
    // GAP: registering with the relay needs this machine's device key and remote server, which come to Core with pairing (PR 12c).
    yield* Console.log(
      'This computer shows under “Join your computers” once `mochi serve` has remote access.',
    );
    return signedIn;
  });

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
  signInWithCode(terminalAccount(data)),
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
