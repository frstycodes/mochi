import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { DiffFile } from '../host/types/git.ts';
import { changeSections, hunkCovers } from './files.ts';

const file = (path: string, oldPath?: string): DiffFile => ({
  path,
  oldPath,
  kind: 'modified',
  staged: false,
  binary: false,
  added: 0,
  removed: 0,
  patch: '',
  hunks: [],
});

test('changeSections orders files like the tree (folders first) and splits staged from unstaged', () => {
  const [flat] = changeSections(
    [file('src/b.ts'), file('README.md'), file('src/lib/a.ts')],
    false,
  );
  assert.equal(flat.title, null);
  assert.deepEqual(
    flat.files.map((f) => f.path),
    ['src/lib/a.ts', 'src/b.ts', 'README.md'],
  );
  const sections = changeSections(
    [file('a.ts'), { ...file('b.ts'), staged: true }],
    true,
  );
  assert.deepEqual(
    sections.map((s) => [s.title, s.files.map((f) => f.path)]),
    [
      ['Staged', ['b.ts']],
      ['Changes', ['a.ts']],
    ],
  );
});

test('hunkCovers checks the hunk range on the given side', () => {
  assert.equal(hunkCovers('@@ -20,8 +22,10 @@ fn', 'additions', 31), true);
  assert.equal(hunkCovers('@@ -20,8 +22,10 @@ fn', 'additions', 32), false);
  assert.equal(hunkCovers('@@ -20,8 +22,10 @@ fn', 'deletions', 21), true);
  assert.equal(hunkCovers('@@ -1 +1 @@', 'additions', 1), true);
  assert.equal(hunkCovers('@@ -0,0 +1,14 @@', 'deletions', 0), false);
});
