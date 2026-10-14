import type { AccountHost } from '../types/account.ts';

// The web build has no main process to hold tokens, so it never signs in (DEVICES.md: tokens live only in main).
const UNCONFIGURED = { status: 'unconfigured', isPersistent: false } as const;

export const account: AccountHost = {
  get: async () => UNCONFIGURED,
  signIn: async () => {
    throw new Error('Signing in needs the desktop app');
  },
  cancelSignIn: async () => {},
  signOut: async () => UNCONFIGURED,
  onChange: () => () => {},
};
