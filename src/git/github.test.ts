import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { formatGithubAccount, parseGithubAccount, parseRemote, tokenVariable } from './github.ts';

test('account refs keep bare logins on github.com and prefix other hosts', () => {
  assert.deepEqual(parseGithubAccount('octo'), { host: 'github.com', login: 'octo' });
  assert.deepEqual(parseGithubAccount('ghe.acme.com/alice_acme'), { host: 'ghe.acme.com', login: 'alice_acme' });
  assert.equal(parseGithubAccount(''), null);
  assert.equal(parseGithubAccount('a b'), null);
  assert.equal(formatGithubAccount({ host: 'github.com', login: 'octo' }), 'octo');
  assert.equal(formatGithubAccount({ host: 'ghe.acme.com', login: 'alice' }), 'ghe.acme.com/alice');
});

test('tokenVariable follows gh: GH_TOKEN for github.com and ghe.com, GH_ENTERPRISE_TOKEN for Enterprise Server', () => {
  assert.equal(tokenVariable('github.com'), 'GH_TOKEN');
  assert.equal(tokenVariable('acme.ghe.com'), 'GH_TOKEN');
  assert.equal(tokenVariable('git.acme.internal'), 'GH_ENTERPRISE_TOKEN');
});

test('parseRemote reads scp-style, ssh:// and https remotes', () => {
  assert.deepEqual(parseRemote('git@github.com:frstycodes/mochi.git'), { host: 'github.com', path: 'frstycodes/mochi' });
  assert.deepEqual(parseRemote('ssh://git@ghe.acme.com:2222/team/app.git'), { host: 'ghe.acme.com', path: 'team/app' });
  assert.deepEqual(parseRemote('https://github.com/frstycodes/mochi'), { host: 'github.com', path: 'frstycodes/mochi' });
  assert.deepEqual(parseRemote('https://user@GitHub.com/a/b.git/'), { host: 'github.com', path: 'a/b' });
  assert.equal(parseRemote('/Users/me/repos/local.git'), null);
  assert.equal(parseRemote('file:///tmp/x'), null);
});
