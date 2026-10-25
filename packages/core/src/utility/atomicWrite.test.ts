import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { writeFileAtomic } from './atomicWrite.ts';

test('writeFileAtomic replaces the file with its data, applies the mode, and leaves no temp file behind', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atomic-'));
  const file = join(dir, 'state.json');
  await writeFileAtomic(file, 'one', 0o600);
  await writeFileAtomic(file, 'two', 0o600);
  assert.equal(await readFile(file, 'utf8'), 'two');
  if (process.platform !== 'win32')
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dir), ['state.json']);
});
