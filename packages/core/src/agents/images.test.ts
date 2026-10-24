import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { sweepImages } from './images.ts';

test('the sweep deletes only old images no saved text names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-images-'));
  const name = (c: string) => `${c.repeat(32)}.png`;
  const past = new Date(Date.now() - 60_000);
  for (const f of [name('a'), name('b'), name('c'), name('d'), 'notes.txt']) {
    writeFileSync(join(dir, f), '');
    utimesSync(join(dir, f), past, past);
  }
  utimesSync(join(dir, name('d')), new Date(), new Date());
  const threads = JSON.stringify({ images: [join(dir, name('a')).replaceAll('/', '\\\\')] });
  const replay = `{"path":"${join(dir, name('b'))}"}\n`;

  const deleted = await sweepImages(dir, [threads, replay], Date.now() - 1000);
  assert.deepEqual(deleted, [name('c')]);
  assert.deepEqual(readdirSync(dir).sort(), [name('a'), name('b'), name('d'), 'notes.txt']);
});
