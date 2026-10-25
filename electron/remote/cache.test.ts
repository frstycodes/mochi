import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { MachineCache } from './cache.ts';

/** Reversible, and visibly not plain text. */
const storage = (isAvailable = true) => ({
  isEncryptionAvailable: () => isAvailable,
  getSelectedStorageBackend: () => 'gnome_libsecret' as const,
  encryptString: (text: string) => Buffer.from(text).reverse(),
  decryptString: (bytes: Buffer) => Buffer.from(bytes).reverse().toString(),
});

test('a snapshot is written encrypted and reads back with when it was saved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-cache-'));
  const cache = new MachineCache(dir, storage());
  cache.write('m1', '{"threads":[]}');
  assert.notEqual(readFileSync(join(dir, 'machine-cache', 'm1'), 'utf8'), '{"threads":[]}');
  assert.equal(cache.read('m1'), '{"threads":[]}');
  assert.ok((cache.savedAt('m1') ?? 0) > 0);
  cache.remove('m1');
  assert.equal(cache.read('m1'), undefined);
});

test('without real encryption nothing is written, and an id with a path in it is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-cache-'));
  new MachineCache(dir, storage(false)).write('m1', 'secret');
  assert.deepEqual(readdirSync(dir), []);
  assert.throws(() => new MachineCache(dir, storage()).write('../m1', 'x'));
});
