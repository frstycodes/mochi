import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isCloneUrl, normalizeOrigin, repoName } from './origin.ts';

test('normalizeOrigin gives https, ssh and scp-style remotes of one repo the same identity', () => {
  for (const url of [
    'https://github.com/Foo/Bar.git',
    'https://github.com/Foo/Bar',
    'https://GitHub.com/Foo/Bar/',
    'https://x-access-token@github.com/Foo/Bar.git',
    'http://github.com:80/Foo/Bar',
    'ssh://git@github.com/Foo/Bar.git',
    'ssh://git@github.com:22/Foo/Bar',
    'git@github.com:Foo/Bar.git',
    'github.com:Foo/Bar',
    'git://github.com/Foo/Bar.git',
  ])
    assert.equal(normalizeOrigin(url), 'github.com/Foo/Bar', url);
  assert.equal(normalizeOrigin('git@gitlab.example.com:group/sub/repo.git'), 'gitlab.example.com/group/sub/repo', 'nested groups');
  assert.equal(normalizeOrigin('https://bitbucket.org/team/repo.git'), 'bitbucket.org/team/repo');
});

test('normalizeOrigin refuses what is not a network remote', () => {
  for (const url of ['', '/Users/me/dev/repo', 'C:\\dev\\repo', 'C:/dev/repo', 'file:///tmp/repo', 'ext::sh -c touch% /tmp/x', 'https://github.com/', 'ftp://host/repo'])
    assert.equal(normalizeOrigin(url), null, url);
});

test('isCloneUrl refuses options, whitespace and helper transports', () => {
  assert.ok(isCloneUrl('https://github.com/Foo/Bar.git'));
  assert.ok(isCloneUrl('git@github.com:Foo/Bar.git'));
  for (const url of ['--upload-pack=touch /tmp/x', '-uhttps://github.com/a/b', 'https://github.com/a/b c', 'ext::sh', 'not a url', 'owner/repo']) assert.equal(isCloneUrl(url), false, url);
  assert.equal(repoName('github.com/Foo/Bar'), 'Bar');
});
