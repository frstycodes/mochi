import { app, shell } from 'electron';
import { canStore, open, seal } from '../secrets';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { MochiAccount, MochiUser } from '@mochi/domain/host/types/account';
import { openWindows } from '../agents/events.ts';
import {
  accountPortalUrl,
  authorizeUrl,
  codeExchange,
  codeFromCallback,
  ENDPOINTS,
  newPkce,
  refreshExchange,
  tokensFrom,
  userFrom,
  type Tokens,
} from './oauth.ts';

/**
 * The Clerk instance's Frontend API URL and its OAuth application's client id: public values, not secrets (a public PKCE
 * client has none). The env vars override them for dev runs against another instance. The OAuth app is Public with
 * Require PKCE on and redirect URI `http://127.0.0.1/callback` (any port is accepted).
 * TODO(owner: Sandesh): this is the development instance; switch to the production one before shipping to other people.
 */
const ISSUER =
  process.env.MOCHI_CLERK_ISSUER ??
  'https://amazed-hyena-4980.clerk.accounts.dev';
const CLIENT_ID = process.env.MOCHI_CLERK_CLIENT_ID ?? 'DrmXYYxWDX3SDT5B';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface Stored {
  user: MochiUser;
  /** `safeStorage` ciphertext, base64. Kept for the relay (DEVICES.md PR 2); never sent to the renderer. */
  refreshToken?: string;
}

type Session = { user: MochiUser; refreshToken?: string } | null;

// Read on first use, not at import: main sets userData (MOCHI_USER_DATA) and `safeStorage` is ready only after that.
let loaded: Session | undefined;
const session = () => (loaded ??= load());
/** In memory only; a fresh one comes from the refresh token when it's missing or about to expire. */
let access: Tokens | undefined;
let refreshing: Promise<string> | undefined;
const EXPIRY_MARGIN_MS = 60_000;
let pending: { cancel: () => void } | null = null;

export function current(): MochiAccount {
  const isPersistent = canStore();
  if (!ISSUER || !CLIENT_ID) return { status: 'unconfigured', isPersistent };
  if (pending) return { status: 'signing-in', isPersistent };
  const signedIn = session();
  return signedIn
    ? { status: 'signed-in', user: signedIn.user, isPersistent }
    : { status: 'signed-out', isPersistent };
}

/** Authorization code + PKCE through the system browser and a one-shot loopback listener (RFC 8252); never an in-app web view. */
export async function signIn(): Promise<MochiAccount> {
  if (!ISSUER || !CLIENT_ID)
    throw new Error("Sign-in isn't set up in this build of Mochi");
  pending?.cancel();
  const pkce = newPkce();
  const { server, port } = await listen();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Sign-in timed out. Try again.')),
        SIGN_IN_TIMEOUT_MS,
      );
      pending = { cancel: () => reject(new Error('Sign-in was cancelled')) };
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/callback') return void res.writeHead(404).end();
        try {
          const found = codeFromCallback(url, pkce.state);
          res
            .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end(
              page(
                'Signed in to Mochi',
                'You can close this tab and go back to Mochi.',
              ),
            );
          resolve(found);
        } catch (error) {
          res
            .writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
            .end(page("Couldn't sign in", (error as Error).message));
          reject(error);
        }
      });
      server.on('close', () => clearTimeout(timer));
      broadcast();
      void shell.openExternal(
        authorizeUrl(ISSUER, CLIENT_ID, redirectUri, pkce),
      );
    });
    const tokens = tokensFrom(
      await post(
        ENDPOINTS.token,
        codeExchange(CLIENT_ID, code, pkce.verifier, redirectUri),
      ),
      Date.now(),
    );
    access = tokens;
    const user = userFrom(
      await getJson(ENDPOINTS.userinfo, tokens.accessToken),
    );
    loaded = { user, refreshToken: tokens.refreshToken };
    save(loaded);
  } finally {
    pending = null;
    server.close();
    broadcast();
  }
  return current();
}

export async function cancelSignIn() {
  pending?.cancel();
}

/** Your profile, email, password and connected accounts are Clerk's to edit: its hosted Account Portal, in your browser. */
export async function openAccountPortal() {
  if (!ISSUER) throw new Error("Sign-in isn't set up in this build of Mochi");
  await shell.openExternal(accountPortalUrl(ISSUER));
}

/** Forgets the session here and revokes its refresh token at Clerk, best effort: signing out never waits on the network to succeed. */
export async function signOut(): Promise<MochiAccount> {
  const refreshToken = session()?.refreshToken;
  loaded = null;
  access = undefined;
  rmSync(storeFile(), { force: true });
  broadcast();
  // GAP: Clerk documents the endpoint but not its parameters; these are RFC 7009's. Not run against a real instance yet.
  if (refreshToken)
    void post(
      ENDPOINTS.revoke,
      new URLSearchParams({
        token: refreshToken,
        token_type_hint: 'refresh_token',
        client_id: CLIENT_ID,
      }),
    ).catch(() => {});
  return current();
}

/**
 * An access token for Mochi's own services (the relay), refreshed when it's within a minute of expiring. Stays in main:
 * callers put it in a request header, never a URL, and it never reaches the renderer.
 */
export function accessToken(now = Date.now()): Promise<string> {
  if (access && access.expiresAt - now > EXPIRY_MARGIN_MS)
    return Promise.resolve(access.accessToken);
  return (refreshing ??= refresh(now).finally(() => (refreshing = undefined)));
}

async function refresh(now: number): Promise<string> {
  const signedIn = session();
  if (!signedIn?.refreshToken)
    throw new Error('Sign in to your Mochi account first');
  const response = await fetch(new URL(ENDPOINTS.token, ISSUER), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: refreshExchange(CLIENT_ID, signedIn.refreshToken),
  });
  // Revoked at Clerk (signed out elsewhere, user deleted): this session is over here too.
  if (response.status === 400 || response.status === 401) {
    await signOut();
    throw new Error('Your Mochi session ended; sign in again');
  }
  if (!response.ok)
    throw new Error(
      `Couldn't reach your Mochi account: Clerk answered ${response.status}`,
    );
  access = tokensFrom(await response.json(), now);
  // Whether Clerk rotates refresh tokens isn't documented: keep whichever one it hands back.
  if (access.refreshToken && access.refreshToken !== signedIn.refreshToken)
    save((loaded = { ...signedIn, refreshToken: access.refreshToken }));
  return access.accessToken;
}

function listen() {
  return new Promise<{ server: Server; port: number }>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : 0,
      });
    });
  });
}

async function post(path: string, body: URLSearchParams) {
  const response = await fetch(new URL(path, ISSUER), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok)
    throw new Error(`Sign-in failed: Clerk answered ${response.status}`);
  return response.status === 200 ? response.json().catch(() => ({})) : {};
}

async function getJson(path: string, accessToken: string) {
  const response = await fetch(new URL(path, ISSUER), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok)
    throw new Error(`Sign-in failed: Clerk answered ${response.status}`);
  return response.json();
}

const changeListeners = new Set<(account: MochiAccount) => void>();

/** For main's own services that follow the account (the relay connection). */
export function onAccountChange(listener: (account: MochiAccount) => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

const broadcast = () => {
  const account = current();
  for (const listener of changeListeners) listener(account);
  for (const win of openWindows())
    win.webContents.send('account:onChange', account);
};

const storeFile = () => join(app.getPath('userData'), 'account.json');

/** Linux with no secret service falls back to a hardcoded key (`basic_text`): nothing is written then, the session lives in memory. */
function load(): Session {
  try {
    const stored = JSON.parse(readFileSync(storeFile(), 'utf8')) as Stored;
    if (typeof stored?.user?.id !== 'string') return null;
    const refreshToken =
      stored.refreshToken && canStore() ? open(stored.refreshToken) : undefined;
    return { user: stored.user, refreshToken };
  } catch {
    return null;
  }
}

function save({ user, refreshToken }: NonNullable<Session>) {
  if (!canStore()) return;
  const stored: Stored = {
    user,
    refreshToken: refreshToken && seal(refreshToken),
  };
  writeFileSync(storeFile(), JSON.stringify(stored), { mode: 0o600 });
}

function page(title: string, body: string) {
  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color-scheme:light dark"><div><h1 style="font-size:20px">${escape(title)}</h1><p>${escape(body)}</p></div>`;
}
