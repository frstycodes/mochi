import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffFile } from '../host/types/git.ts';
import type { Step } from '../model.ts';
import { filesForStep, groupByDir, hunkCovers } from './files.ts';

const file = (path: string, oldPath?: string): DiffFile => ({ path, oldPath, kind: 'modified', staged: false, binary: false, added: 0, removed: 0, patch: '', hunks: [] });

test('filesForStep matches exact files, directory footprints and rename sources', () => {
  const files = [file('emails/welcome.tsx'), file('apps/api/auth.ts'), file('apps/api/auth.test.ts'), file('new/place.ts', 'apps/worker/onboarding.ts')];
  const step = { footprint: ['emails/', 'apps/api/auth.ts', 'apps/worker/onboarding.ts'] } as Step;
  assert.deepEqual(filesForStep(files, step).map((f) => f.path), ['emails/welcome.tsx', 'apps/api/auth.ts', 'new/place.ts']);
  assert.equal(filesForStep(files, undefined).length, 4);
});

test('groupByDir sorts and groups by directory, root files under ""', () => {
  const groups = groupByDir([file('src/b.ts'), file('README.md'), file('src/a.ts')]);
  assert.deepEqual(groups.map((g) => [g.dir, g.files.map((f) => f.path)]), [
    ['', ['README.md']],
    ['src/', ['src/a.ts', 'src/b.ts']],
  ]);
});

test('hunkCovers checks the hunk range on the given side', () => {
  assert.equal(hunkCovers('@@ -20,8 +22,10 @@ fn', 'additions', 31), true);
  assert.equal(hunkCovers('@@ -20,8 +22,10 @@ fn', 'additions', 32), false);
  assert.equal(hunkCovers('@@ -20,8 +22,10 @@ fn', 'deletions', 21), true);
  assert.equal(hunkCovers('@@ -1 +1 @@', 'additions', 1), true);
  assert.equal(hunkCovers('@@ -0,0 +1,14 @@', 'deletions', 0), false);
});
