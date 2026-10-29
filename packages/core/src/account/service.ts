import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import type { AccountHost } from '@mochi/domain/host/types/account';
import { push } from '../agents/events.ts';
import type { HostMethods } from '../hostMethods.ts';
import { Capabilities } from '../hostServer.ts';
import { KeyStore } from '../keys/keyStore.ts';
import { CLERK, makeAccount, type Account, type Session } from './session.ts';

/** The push every window's `host.account.onChange` hears; main hears it too, for the relay connection. */
export const ACCOUNT_CHANGED = 'account:onChange';

/** Core's account, with the browser it opens served by main (`main.openExternal`); headless, there is none. */
export class AccountService extends Context.Service<AccountService>()(
  'mochi/core/Account',
  {
    make: (userData: string | undefined) =>
      Effect.gen(function* () {
        const keys = yield* KeyStore;
        const capabilities = yield* Capabilities;
        const call = (
          capability: 'main' | 'secureStorage',
          method: string,
          args: ReadonlyArray<unknown>,
        ) =>
          Effect.runPromise(
            capabilities
              .call({ capability, method, args })
              .pipe(
                Effect.catch((error) =>
                  Effect.die(
                    typeof error === 'string' ? new Error(error) : error,
                  ),
                ),
              ),
          );
        return makeAccount({
          keys,
          ...CLERK,
          openUrl: async (url) => {
            if (!capabilities.offers('main'))
              throw new Error(
                'This computer has no browser to sign in with: run `mochi login` in its terminal',
              );
            await call('main', 'openExternal', [url]);
          },
          legacy: async () =>
            userData && capabilities.offers('secureStorage')
              ? legacySession(userData, (sealed) =>
                  call('secureStorage', 'decrypt', [sealed]).then(String),
                )
              : undefined,
          onChange: (account) =>
            push({ channel: ACCOUNT_CHANGED, payload: account }),
        });
      }),
  },
) {
  static readonly layer = (userData: string | undefined) =>
    Layer.effect(this, this.make(userData));
}

/**
 * The session main kept before Core did: `<userData>/account.json`, its refresh token sealed with `safeStorage`. Read once,
 * then deleted, so desktop users stay signed in across the move.
 */
export async function legacySession(
  userData: string,
  open: (sealed: string) => Promise<string>,
): Promise<Session | undefined> {
  const file = path.join(userData, 'account.json');
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  const stored = JSON.parse(text) as {
    user?: Session['user'];
    refreshToken?: string;
  };
  if (typeof stored?.user?.id !== 'string') return undefined;
  const session = {
    user: stored.user,
    ...(stored.refreshToken && {
      refreshToken: await open(stored.refreshToken),
    }),
  };
  await rm(file, { force: true });
  return session;
}

export const accountHost = (account: Account) =>
  ({
    get: () => account.current(),
    signIn: () => account.signIn(),
    cancelSignIn: () => account.cancelSignIn(),
    signOut: async () => (await account.signOut()).account,
    openAccountPortal: () => account.openAccountPortal(),
  }) satisfies HostMethods<AccountHost>;
