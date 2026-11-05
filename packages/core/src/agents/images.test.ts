import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { safeName, sweepAttachments, sweepImages } from './images.ts';

const T0 = Date.UTC(2026, 0, 1);

test('the sweep deletes only old images no saved text names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-images-'));
  const name = (c: string) => `${c.repeat(32)}.png`;
  const past = new Date(T0 - 60_000);
  for (const f of [name('a'), name('b'), name('c'), name('d'), 'notes.txt']) {
    writeFileSync(join(dir, f), '');
    utimesSync(join(dir, f), past, past);
  }
  utimesSync(join(dir, name('d')), new Date(T0), new Date(T0));
  const threads = JSON.stringify({
    images: [join(dir, name('a')).replaceAll('/', '\\\\')],
  });
  const replay = `{"path":"${join(dir, name('b'))}"}\n`;

  const deleted = await sweepImages(dir, [threads, replay], T0 - 1000);
  assert.deepEqual(deleted, [name('c')]);
  assert.deepEqual(readdirSync(dir).sort(), [
    name('a'),
    name('b'),
    name('d'),
    'notes.txt',
  ]);
});

test('an attached file keeps its name inside one path segment', () => {
  assert.equal(safeName('report.pdf'), 'report.pdf');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('C:\\Users\\me\\notes.txt'), 'notes.txt');
  assert.equal(safeName('.env'), 'env');
  assert.equal(safeName('a\nb?.csv'), 'a_b_.csv');
  assert.equal(safeName('..'), 'attachment');
  const long = safeName(`${'x'.repeat(200)}.xlsx`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.xlsx'));
});

test('the attachment sweep deletes old folders no saved text names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-attachments-'));
  const past = new Date(T0 - 60_000);
  for (const c of ['a', 'b']) {
    mkdirSync(join(dir, c.repeat(32)));
    writeFileSync(join(dir, c.repeat(32), 'report.pdf'), '');
    utimesSync(join(dir, c.repeat(32)), past, past);
  }
  const thread = `Attached files:\n- \`${join(dir, 'a'.repeat(32), 'report.pdf')}\``;

  const deleted = await sweepAttachments(dir, [thread], T0 - 1000);
  assert.deepEqual(deleted, ['b'.repeat(32)]);
  assert.deepEqual(readdirSync(dir), ['a'.repeat(32)]);
});
