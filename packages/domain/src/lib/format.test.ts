import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { formatBytes, plural } from './format.ts';

test('plural picks the singular only for one', () => {
  assert.equal(plural(1, 'file', 'files'), 'file');
  assert.equal(plural(0, 'file', 'files'), 'files');
  assert.equal(plural(2, 'file', 'files'), 'files');
});

test('formatBytes scales through B, kB, MB and GB', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1,023 B');
  assert.equal(formatBytes(1024), '1 kB');
  assert.equal(formatBytes(1536), '1.5 kB');
  assert.equal(formatBytes(1024 ** 2), '1 MB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5 GB');
  assert.equal(formatBytes(2 * 1024 ** 4), '2,048 GB');
});
