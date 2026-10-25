import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { userFromRequest } from './auth.ts';

const ISSUER = 'https://clerk.example.dev';
const CLIENT = 'mochi_client';

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }],
  });
  const sign = (
    claims: Record<string, unknown>,
    issuer = ISSUER,
    expires = '1h',
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey);
  return { keys, sign };
}

const request = (token?: string) =>
  new Request('https://relay.example/v1/machines', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

test('only a valid token from the instance names a user', async () => {
  const { keys, sign } = await signer();
  const other = await signer();
  assert.equal(
    await userFromRequest(
      request(await sign({ sub: 'user_1', client_id: CLIENT })),
      ISSUER,
      CLIENT,
      keys,
    ),
    'user_1',
  );
  assert.equal(
    await userFromRequest(request(), ISSUER, CLIENT, keys),
    null,
    'no token',
  );
  assert.equal(
    await userFromRequest(
      request(await other.sign({ sub: 'user_1', client_id: CLIENT })),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'signed by another key',
  );
  assert.equal(
    await userFromRequest(
      request(
        await sign(
          { sub: 'user_1', client_id: CLIENT },
          'https://evil.example',
        ),
      ),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'another issuer',
  );
  assert.equal(
    await userFromRequest(
      request(await sign({ sub: 'user_1', client_id: CLIENT }, ISSUER, '-1m')),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'expired',
  );
  assert.equal(
    await userFromRequest(
      request(await sign({ client_id: CLIENT })),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'no subject',
  );
  assert.equal(
    await userFromRequest(
      request(await sign({ sub: 'user_1', client_id: 'another_app' })),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'issued to another app',
  );
  assert.equal(
    await userFromRequest(
      request(await sign({ sub: 'user_1' })),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'no client_id',
  );
  assert.equal(
    await userFromRequest(
      new Request('https://relay.example/?token=x'),
      ISSUER,
      CLIENT,
      keys,
    ),
    null,
    'a token in the URL is never read',
  );
});
