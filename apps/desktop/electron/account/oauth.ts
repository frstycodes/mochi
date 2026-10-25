import { createHash, randomBytes } from 'node:crypto';
import type { MochiUser } from '../../src/host/types/account.ts';

// Paths from Clerk's discovery document (`<issuer>/.well-known/openid-configuration`), the same on every instance.
export const ENDPOINTS = {
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  userinfo: '/oauth/userinfo',
  revoke: '/oauth/token/revoke',
};
const SCOPES = 'openid profile email offline_access';

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
}

export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(16).toString('base64url'),
  };
}

export function authorizeUrl(
  issuer: string,
  clientId: string,
  redirectUri: string,
  pkce: Pkce,
) {
  const url = new URL(ENDPOINTS.authorize, issuer);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

/**
 * Clerk's hosted Account Portal profile page (profile, email, password, connected accounts, delete account), derived from the
 * Frontend API host: dev `<slug>.clerk.accounts.dev` → `<slug>.accounts.dev`, production `clerk.<domain>` → `accounts.<domain>`.
 */
export function accountPortalUrl(issuer: string) {
  const url = new URL(issuer);
  url.hostname = url.hostname.endsWith('.clerk.accounts.dev')
    ? url.hostname.replace('.clerk.accounts.dev', '.accounts.dev')
    : url.hostname.replace(/^clerk\./, 'accounts.');
  url.pathname = '/user';
  return url.href;
}

/** The code from the browser's redirect, refusing one whose `state` isn't this sign-in's (a forged or stale redirect). */
export function codeFromCallback(url: URL, state: string): string {
  const error = url.searchParams.get('error');
  if (error)
    throw new Error(
      error === 'access_denied'
        ? 'Sign-in was cancelled'
        : `Sign-in failed: ${url.searchParams.get('error_description') ?? error}`,
    );
  if (url.searchParams.get('state') !== state)
    throw new Error('Sign-in failed: the browser returned a different sign-in');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Sign-in failed: no code came back');
  return code;
}

export const codeExchange = (
  clientId: string,
  code: string,
  verifier: string,
  redirectUri: string,
) =>
  new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

export const refreshExchange = (clientId: string, refreshToken: string) =>
  new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

export function tokensFrom(body: unknown, now: number): Tokens {
  const b = body as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof b?.access_token !== 'string')
    throw new Error('Sign-in failed: the token response had no access token');
  return {
    accessToken: b.access_token,
    refreshToken:
      typeof b.refresh_token === 'string' ? b.refresh_token : undefined,
    // Clerk's access tokens last a day; an answer without `expires_in` is treated as an hour.
    expiresAt:
      now + (typeof b.expires_in === 'number' ? b.expires_in : 3600) * 1000,
  };
}

/** OIDC userinfo → what the renderer shows. `sub` is the Clerk user id. */
export function userFrom(body: unknown): MochiUser {
  const b = body as Record<string, unknown>;
  if (typeof b?.sub !== 'string')
    throw new Error('Sign-in failed: the account has no id');
  const text = (key: string) =>
    typeof b[key] === 'string' && b[key] ? (b[key] as string) : null;
  return {
    id: b.sub,
    name: text('name') ?? text('preferred_username'),
    email: text('email'),
    imageUrl: text('picture'),
  };
}
