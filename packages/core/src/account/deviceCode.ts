import { ENDPOINTS, SCOPES, tokensFrom, type Tokens } from './oauth.ts';

/** What the person types, and where: shown by `mochi login`. */
export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  /** The same page with the code filled in, when Clerk offers it. */
  verificationUriComplete?: string;
}

export interface DeviceSignInOptions {
  issuer: string;
  clientId: string;
  /** Called once the code is issued, before polling starts. */
  onCode: (code: DeviceCode) => void;
  signal?: AbortSignal;
  /** Waits between polls; tests pass one that doesn't. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
/** RFC 8628 §3.2: when `expires_in` is missing. Clerk's codes last ten minutes. */
const DEFAULT_EXPIRY_S = 600;
/** RFC 8628 §3.2: when `interval` is missing. */
const DEFAULT_INTERVAL_S = 5;
/** RFC 8628 §3.5: `slow_down` adds five seconds to every later poll. */
const SLOW_DOWN_S = 5;

export const NO_DEVICE_SIGN_IN =
  "This Clerk app doesn't allow device sign-in: turn on the Device Authorization Grant for its OAuth application";

/**
 * Clerk's device authorization grant (RFC 8628, beta, on per OAuth app): asks for a code, hands it to `onCode`, then polls the
 * token endpoint until the person approves it in a browser. The endpoints come from the server's metadata, never hardcoded.
 */
export async function deviceSignIn({
  issuer,
  clientId,
  onCode,
  signal,
  wait = sleep,
  now = Date.now,
}: DeviceSignInOptions): Promise<Tokens> {
  const metadata = await json(
    await fetch(new URL('/.well-known/oauth-authorization-server', issuer), {
      signal,
    }),
  );
  const deviceEndpoint = text(metadata.device_authorization_endpoint);
  if (!deviceEndpoint) throw new Error(NO_DEVICE_SIGN_IN);
  const tokenEndpoint =
    text(metadata.token_endpoint) ?? new URL(ENDPOINTS.token, issuer).href;

  const issued = await fetch(deviceEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
    signal,
  });
  const grant = await json(issued);
  if (!issued.ok)
    throw new Error(
      grant.error === 'unauthorized_client' ||
        grant.error === 'unsupported_grant_type'
        ? NO_DEVICE_SIGN_IN
        : `Sign-in failed: Clerk answered ${issued.status}${describe(grant)}`,
    );
  const deviceCode = text(grant.device_code);
  const userCode = text(grant.user_code);
  const verificationUri = text(grant.verification_uri);
  if (!deviceCode || !userCode || !verificationUri)
    throw new Error('Sign-in failed: Clerk sent no code');
  const verificationUriComplete = text(grant.verification_uri_complete);
  onCode({
    userCode,
    verificationUri,
    ...(verificationUriComplete && { verificationUriComplete }),
  });

  const expiresAt = now() + seconds(grant.expires_in, DEFAULT_EXPIRY_S) * 1000;
  let interval = seconds(grant.interval, DEFAULT_INTERVAL_S);
  for (;;) {
    await wait(interval * 1000, signal);
    if (now() >= expiresAt) throw expired();
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: GRANT_TYPE,
        device_code: deviceCode,
        client_id: clientId,
      }),
      signal,
    });
    const body = await json(response);
    if (response.ok) return tokensFrom(body, now());
    switch (body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += SLOW_DOWN_S;
        continue;
      case 'access_denied':
        throw new Error('Sign-in was denied in the browser');
      case 'expired_token':
        throw expired();
      default:
        throw new Error(
          `Sign-in failed: Clerk answered ${response.status}${describe(body)}`,
        );
    }
  }
}

const expired = () =>
  new Error('The sign-in code expired before it was approved. Run it again.');

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Sign-in was cancelled'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Sign-in was cancelled'));
      },
      { once: true },
    );
  });

const json = (response: Response) =>
  response.json().catch(() => ({})) as Promise<Record<string, unknown>>;

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;

const seconds = (value: unknown, fallback: number) =>
  typeof value === 'number' && value > 0 ? value : fallback;

const describe = (body: Record<string, unknown>) => {
  const reason = text(body.error_description) ?? text(body.error);
  return reason ? ` (${reason})` : '';
};
