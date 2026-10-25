import type { AccountHost } from '../../src/host/types/account.ts';
import {
  cancelSignIn,
  current,
  openAccountPortal,
  signIn,
  signOut,
} from '../account/session.ts';
import type { Handlers } from './handlers.ts';

export const account = {
  get: async () => current(),
  signIn,
  cancelSignIn,
  signOut,
  openAccountPortal,
} satisfies Handlers<AccountHost>;
