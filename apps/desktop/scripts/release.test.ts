import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { releaseVersion } from './release.ts';

const date = new Date('2026-10-27T03:00:00Z');

test('stable releases only from the tag matching package.json', () => {
  assert.equal(
    releaseVersion('stable', {
      version: '0.2.0',
      tag: 'v0.2.0',
      date,
      run: '7',
    }),
    '0.2.0',
  );
  assert.throws(
    () =>
      releaseVersion('stable', {
        version: '0.2.0',
        tag: 'v0.1.9',
        date,
        run: '7',
      }),
    /doesn't match/,
  );
});

test('nightly stamps the UTC day and run onto the next version', () => {
  assert.equal(
    releaseVersion('nightly', { version: '0.2.0', date, run: '42' }),
    '0.2.0-nightly.20261027.42',
  );
});
