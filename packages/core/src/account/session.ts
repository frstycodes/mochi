import { createServer, type Server } from 'node:http';
import type { MochiAccount, MochiUser } from '@mochi/domain/host/types/account';
import type { Keys } from '../keys/keyStore.ts';
import { deviceSignIn, type DeviceCode } from './deviceCode.ts';
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
 * Require PKCE on and redirect URI `http://127.0.0.1/callback` (any port is accepted); `mochi login` also needs its Device
 * Authorization Grant turned on.
 * TODO(owner: Sandesh): this is the development instance; switch to the production one before shipping to other people.
 */
export const CLERK = {
  issuer:
    process.env.MOCHI_CLERK_ISSUER ??
    'https://amazed-hyena-4980.clerk.accounts.dev',
  clientId: process.env.MOCHI_CLERK_CLIENT_ID ?? 'DrmXYYxWDX3SDT5B',
};

/** The session's name in `Keys`. */
export const ACCOUNT_KEY = 'account';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

export interface Session {
  user: MochiUser;
  /** Kept for the relay; never sent to a window. */
  refreshToken?: string;
}

export interface AccountOptions {
  keys: Keys;
  issuer: string;
  clientId: string;
  /** Opens a page in this computer's browser; rejects when it has none (headless). */
  openUrl: (url: string) => Promise<void>;
  /** A session saved where it was kept before `Keys` (main's `account.json`), moved over on first read. */
  legacy?: () => Promise<Session | undefined>;
  onChange?: (account: MochiAccount) => void;
}

export type Account = ReturnType<typeof makeAccount>;

/**
 * This machine's Mochi account: its Clerk session, kept in `Keys` under `account`, and short-lived access tokens for the relay
 * (in memory). Signs in through the system browser (PKCE) where there is one, or with a device code (`mochi login`).
 */
export function makeAccount(options: AccountOptions) {
  const { keys, issuer, clientId } = options;
  /** Set when `Keys` refused the session (no usable keychain): it lasts until this process ends. */
  let unsaved: Session | null | undefined;
  let access: Tokens | undefined;
  let refreshing: Promise<string> | undefined;
  let pending: { cancel: () => void } | null = null;

  /** Read each time, so a `mochi login` in another shell is seen by a running `mochi serve`. */
  async function session(): Promise<Session | null> {
    if (unsaved !== undefined) return unsaved;
    const saved = await keys.get(ACCOUNT_KEY).catch(() => undefined);
    if (saved !== undefined) return parse(saved);
    const legacy = await options.legacy?.().catch(() => undefined);
    if (!legacy) return null;
    await save(legacy);
    return legacy;
  }

  async function save(next: Session | null) {
    try {
      if (next) await keys.set(ACCOUNT_KEY, JSON.stringify(next));
      else await keys.delete(ACCOUNT_KEY);
      unsaved = undefined;
    } catch {
      unsaved = next;
    }
  }

  async function current(): Promise<MochiAccount> {
    const signedIn = await session();
    const isPersistent = unsaved === undefined;
    if (!issuer || !clientId) return { status: 'unconfigured', isPersistent };
    if (pending) return { status: 'signing-in', isPersistent };
    return signedIn
      ? { status: 'signed-in', user: signedIn.user, isPersistent }
      : { status: 'signed-out', isPersistent };
  }

  const broadcast = async () => options.onChange?.(await current());

  const requireConfigured = () => {
    if (!issuer || !clientId)
      throw new Error("Sign-in isn't set up in this build of Mochi");
  };

  /** The tokens' user, saved as this machine's session. */
  async function finish(tokens: Tokens) {
    access = tokens;
    const user = userFrom(
      await getJson(ENDPOINTS.userinfo, tokens.accessToken),
    );
    await save({ user, refreshToken: tokens.refreshToken });
  }

  /** Authorization code + PKCE through the system browser and a one-shot loopback listener (RFC 8252); never an in-app web view. */
  async function signIn(): Promise<MochiAccount> {
    requireConfigured();
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
          if (url.pathname !== '/callback')
            return void res.writeHead(404).end();
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
        void broadcast();
        options
          .openUrl(authorizeUrl(issuer, clientId, redirectUri, pkce))
          .catch(reject);
      });
      await finish(
        tokensFrom(
          await post(
            ENDPOINTS.token,
            codeExchange(clientId, code, pkce.verifier, redirectUri),
          ),
          Date.now(),
        ),
      );
    } finally {
      pending = null;
      server.close();
      await broadcast();
    }
    return current();
  }

  /** The device authorization grant, for a computer with no browser of its own: `onCode` shows what to type, and where. */
  async function signInWithCode(
    onCode: (code: DeviceCode) => void,
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>,
  ): Promise<MochiAccount> {
    requireConfigured();
    pending?.cancel();
    const controller = new AbortController();
    pending = { cancel: () => controller.abort() };
    try {
      await broadcast();
      await finish(
        await deviceSignIn({
          issuer,
          clientId,
          onCode,
          signal: controller.signal,
          wait,
        }),
      );
    } finally {
      pending = null;
      await broadcast();
    }
    return current();
  }

  /**
   * Forgets the session here, then revokes its refresh token at Clerk. Signing out never waits on the network to succeed:
   * `revoked` settles once Clerk answered (or didn't), for a CLI that would otherwise exit first.
   */
  async function signOut() {
    const refreshToken = (await session())?.refreshToken;
    access = undefined;
    await save(null);
    await broadcast();
    // GAP: Clerk documents the endpoint but not its parameters; these are RFC 7009's. Not run against a real instance yet.
    const revoked = refreshToken
      ? post(
          ENDPOINTS.revoke,
          new URLSearchParams({
            token: refreshToken,
            token_type_hint: 'refresh_token',
            client_id: clientId,
          }),
        ).then(
          () => {},
          () => {},
        )
      : Promise.resolve();
    return { account: await current(), revoked };
  }

  /**
   * An access token for Mochi's own services (the relay), refreshed when it's within a minute of expiring. Callers put it in
   * a request header, never a URL, and it never reaches a window.
   */
  function accessToken(now = Date.now()): Promise<string> {
    if (access && access.expiresAt - now > EXPIRY_MARGIN_MS)
      return Promise.resolve(access.accessToken);
    return (refreshing ??= refresh(now).finally(
      () => (refreshing = undefined),
    ));
  }

  async function refresh(now: number): Promise<string> {
    const signedIn = await session();
    if (!signedIn?.refreshToken)
      throw new Error('Sign in to your Mochi account first');
    const response = await fetch(new URL(ENDPOINTS.token, issuer), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshExchange(clientId, signedIn.refreshToken),
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
      await save({ ...signedIn, refreshToken: access.refreshToken });
    return access.accessToken;
  }

  async function post(path: string, body: URLSearchParams) {
    const response = await fetch(new URL(path, issuer), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok)
      throw new Error(`Sign-in failed: Clerk answered ${response.status}`);
    return response.status === 200 ? response.json().catch(() => ({})) : {};
  }

  async function getJson(path: string, token: string) {
    const response = await fetch(new URL(path, issuer), {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      throw new Error(`Sign-in failed: Clerk answered ${response.status}`);
    return response.json();
  }

  return {
    current,
    signIn,
    signInWithCode,
    cancelSignIn: async () => pending?.cancel(),
    signOut,
    /** Your profile, email, password and connected accounts are Clerk's to edit: its hosted Account Portal, in your browser. */
    openAccountPortal: async () => {
      requireConfigured();
      await options.openUrl(accountPortalUrl(issuer));
    },
    accessToken,
  };
}

function parse(saved: string): Session | null {
  try {
    const session = JSON.parse(saved) as Session;
    return typeof session?.user?.id === 'string' ? session : null;
  } catch {
    return null;
  }
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

function page(title: string, body: string) {
  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color-scheme:light dark"><div><h1 style="font-size:20px">${escape(title)}</h1><p>${escape(body)}</p></div>`;
}
