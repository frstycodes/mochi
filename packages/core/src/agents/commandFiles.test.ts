import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vite-plus/test';
import { changedPaths, snapshot } from './commandFiles.ts';

test('changedPaths: newly changed, changed again and back to clean count; untouched ones do not', () => {
  const from = new Map([
    ['a.ts', '1:1'],
    ['b.ts', '2:2'],
    ['c.ts', '3:3'],
  ]);
  const to = new Map([
    ['a.ts', '1:1'],
    ['b.ts', '5:9'],
    ['d.py', '4:4'],
  ]);
  assert.deepEqual(changedPaths(from, to), ['b.ts', 'c.ts', 'd.py']);
});

test("a script's writes show between two snapshots, edits to an already-changed file included", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'command-files-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(path.join(dir, 'kept.txt'), 'one\n');
    writeFileSync(path.join(dir, 'dirty.txt'), 'one\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    writeFileSync(path.join(dir, 'dirty.txt'), 'two\n');

    const before = await snapshot(dir);
    writeFileSync(path.join(dir, 'dirty.txt'), 'three, longer\n');
    writeFileSync(path.join(dir, 'made.py'), 'print(1)\n');
    const after = await snapshot(dir);

    assert.deepEqual(changedPaths(before, after), ['dirty.txt', 'made.py']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
