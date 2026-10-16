import type { Manifest } from './manifest.ts';

/**
 * Your Mochi account (Clerk): identity for pairing computers and the relay (DEVICES.md). Not a Claude or Codex login.
 * Main holds the tokens; the renderer only ever sees this.
 */
export interface MochiAccount {
  /** `unconfigured`: this build has no Clerk app to sign in to. */
  status: 'unconfigured' | 'signed-out' | 'signing-in' | 'signed-in';
  user?: MochiUser;
  /** False when the OS has no secret store (some Linux desktops): the session lasts until Mochi quits. */
  isPersistent: boolean;
}

export interface MochiUser {
  id: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
}

export interface AccountHost {
  get(): Promise<MochiAccount>;
  /** Opens sign-in in your browser; resolves once you finish, cancel or it times out (throws then, saying which). */
  signIn(): Promise<MochiAccount>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<MochiAccount>;
  /** Opens Clerk's Account Portal (profile, email, password) in your browser. */
  openAccountPortal(): Promise<void>;
  onChange(callback: (account: MochiAccount) => void): () => void;
}

export const accountMethods = {
  get: 'invoke',
  signIn: 'invoke',
  cancelSignIn: 'invoke',
  signOut: 'invoke',
  openAccountPortal: 'invoke',
  onChange: 'event',
} satisfies Manifest<AccountHost>;
