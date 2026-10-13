import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFolderSource, sourceFrom, sourceUrl } from './sources.ts';

test('a source is a link when it has a scheme or a host before a path, a file otherwise', () => {
  assert.deepEqual(sourceFrom('  https://example.com  '), { kind: 'link', label: 'https://example.com' });
  assert.equal(sourceFrom('redis.io/docs/latest')?.kind, 'link');
  assert.equal(sourceFrom('localhost.test:3000/admin')?.kind, 'link');
  assert.equal(sourceFrom('www.example.com')?.kind, 'link');
  assert.equal(sourceFrom('docs/api/limits.md')?.kind, 'file');
  assert.equal(sourceFrom('README.md')?.kind, 'file');
  assert.equal(sourceFrom('   '), null);
  assert.equal(sourceUrl('redis.io/docs'), 'https://redis.io/docs');
  assert.equal(sourceUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(isFolderSource({ kind: 'file', label: 'apps/api/legacy-auth/' }), true);
});
