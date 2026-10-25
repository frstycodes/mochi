import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { cached, uncache } from './cache.ts';

test('cached shares one load, drops failures, and uncache forces a reload', async () => {
  let loads = 0;
  const load = async () => ++loads;
  const [a, b] = await Promise.all([
    cached('k', '1 minute', load),
    cached('k', '1 minute', load),
  ]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  await uncache('k');
  assert.equal(await cached('k', '1 minute', load), 2);

  await assert.rejects(
    cached('bad', '1 minute', () => Promise.reject(new Error('down'))),
    /down/,
  );
  assert.equal(await cached('bad', '1 minute', async () => 'up'), 'up');
});
