import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oauthBounce } from './oauth.ts';

test('a returning sign-in goes on to Mochi on this machine, with every parameter', () => {
  const res = oauthBounce(new URL('https://relay.example/oauth/callback?code=abc&state=53211-0123456789abcdef0123456789abcdef'));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'http://127.0.0.1:53211/oauth-callback?code=abc&state=53211-0123456789abcdef0123456789abcdef');
});

test('anything without a port-first state is refused, so it never redirects elsewhere', () => {
  for (const state of ['', 'abc', '99999-0123456789abcdef', '80-short', 'evil.com-0123456789abcdef0123'])
    assert.equal(oauthBounce(new URL(`https://relay.example/oauth/callback?code=x&state=${state}`)).status, 400, state);
});
