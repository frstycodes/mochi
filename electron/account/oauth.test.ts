import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { accountPortalUrl, authorizeUrl, codeFromCallback, newPkce, tokensFrom, userFrom } from './oauth.ts';

test('the authorize URL carries an S256 challenge of the verifier, never the verifier itself', () => {
  const pkce = newPkce();
  const url = new URL(authorizeUrl('https://clerk.example.dev', 'client_1', 'http://127.0.0.1:5123/callback', pkce));
  assert.equal(url.origin + url.pathname, 'https://clerk.example.dev/oauth/authorize');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(pkce.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid profile email offline_access');
  assert.ok(!url.href.includes(pkce.verifier));
});

test('a callback is taken only with this sign-in’s state', () => {
  const at = (query: string) => new URL(`http://127.0.0.1:5123/callback?${query}`);
  assert.equal(codeFromCallback(at('code=abc&state=s1'), 's1'), 'abc');
  assert.throws(() => codeFromCallback(at('code=abc&state=other'), 's1'), /different sign-in/);
  assert.throws(() => codeFromCallback(at('state=s1'), 's1'), /no code/);
  assert.throws(() => codeFromCallback(at('error=access_denied&state=s1'), 's1'), /cancelled/);
});

test('token and userinfo responses are read defensively', () => {
  assert.deepEqual(tokensFrom({ access_token: 'a', refresh_token: 'r', expires_in: 60 }, 1000), { accessToken: 'a', refreshToken: 'r', expiresAt: 61_000 });
  assert.throws(() => tokensFrom({ error: 'invalid_grant' }, 0), /no access token/);
  assert.deepEqual(userFrom({ sub: 'user_1', preferred_username: 'sp', email: 'a@b.c', picture: '' }), { id: 'user_1', name: 'sp', email: 'a@b.c', imageUrl: null });
  assert.throws(() => userFrom({}), /no id/);
});

test('the Account Portal sits beside the Frontend API on dev and production instances', () => {
  assert.equal(accountPortalUrl('https://amazed-hyena-4980.clerk.accounts.dev'), 'https://amazed-hyena-4980.accounts.dev/user');
  assert.equal(accountPortalUrl('https://clerk.mochi.app'), 'https://accounts.mochi.app/user');
});
