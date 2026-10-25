import type { AccountHost } from '@mochi/domain/host/types/account';
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
