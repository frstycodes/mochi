import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const remoteKeys = new Map<string, JWTVerifyGetKey>();

/**
 * The Clerk user a request comes from: the OAuth access token Mochi's main process holds (`electron/account/`), sent as
 * `Authorization: Bearer`, verified against the instance's JWKS (cached per isolate by jose). Clerk issues JWT access
 * tokens by default; an opaque one fails here.
 * GAP: Clerk doesn't document the access token's audience claim. Once a real token is decoded, pin `aud` / `client_id`
 * to Mochi's OAuth client here, so a token another app of the same Clerk instance got can't open the relay.
 */
export async function userFromRequest(request: Request, issuer: string, keys: JWTVerifyGetKey = remoteJwks(issuer)): Promise<string | null> {
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, algorithms: ['RS256'] });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function remoteJwks(issuer: string) {
  let keys = remoteKeys.get(issuer);
  if (!keys) remoteKeys.set(issuer, (keys = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer))));
  return keys;
}
