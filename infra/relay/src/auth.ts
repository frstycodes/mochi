import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const remoteKeys = new Map<string, JWTVerifyGetKey>();

/**
 * The Clerk user a request comes from: the OAuth access token Mochi's main process holds (`electron/account/`), sent as
 * `Authorization: Bearer`, verified against the instance's JWKS (cached per isolate by jose). Clerk issues JWT access
 * tokens by default; an opaque one fails here. Clerk's access tokens carry no `aud` but a `client_id` (read from a real
 * sign-in, 2026-10-14), pinned to Mochi's OAuth client so a token another app of the same instance got can't open the relay.
 */
export async function userFromRequest(
  request: Request,
  issuer: string,
  clientId: string,
  keys: JWTVerifyGetKey = remoteJwks(issuer),
): Promise<string | null> {
  const token = /^Bearer (\S+)$/.exec(
    request.headers.get('authorization') ?? '',
  )?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      algorithms: ['RS256'],
    });
    if (payload.client_id !== clientId) return null;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function remoteJwks(issuer: string) {
  let keys = remoteKeys.get(issuer);
  if (!keys)
    remoteKeys.set(
      issuer,
      (keys = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer))),
    );
  return keys;
}
