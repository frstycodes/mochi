import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { threadStore } from './threadStore.ts';

const index = (ids: string[]) => JSON.stringify({ version: 1, threadIds: ids });

test('a save writes only the threads it is given, prunes dropped ones, and loads in index order', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-threads-'));
  const store = threadStore(join(root, 'threads'), join(root, 'threads.json'));
  assert.equal(await store.load(), null);

  await store.save(index(['b', 'a']), { a: '{"a":1}', b: '{"b":1}' });
  await store.save(index(['b', 'c']), { c: '{"c":1}' });
  assert.deepEqual(await store.load(), { index: index(['b', 'c']), threads: ['{"b":1}', '{"c":1}'] });
  assert.deepEqual(readdirSync(join(root, 'threads')).sort(), ['b.json', 'c.json', 'index.json']);
});

test('an old threads.json loads as the index until the first split save, which keeps it as threads.legacy.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-threads-'));
  const store = threadStore(join(root, 'threads'), join(root, 'threads.json'));
  writeFileSync(join(root, 'threads.json'), '{"version":1,"threads":[]}');
  assert.deepEqual(await store.load(), { index: '{"version":1,"threads":[]}', threads: [] });

  await store.save(index(['a']), { a: '{}' });
  assert.ok(!existsSync(join(root, 'threads.json')) && existsSync(join(root, 'threads.legacy.json')));
  assert.deepEqual(await store.load(), { index: index(['a']), threads: ['{}'] });
});

test('a thread id that could leave the folder is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-threads-'));
  await assert.rejects(threadStore(root, join(root, 'threads.json')).save(index(['../x']), { '../x': '{}' }), TypeError);
});
