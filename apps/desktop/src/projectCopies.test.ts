import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Project } from '@mochi/domain/host/types/projects';
import type { CatalogProject } from './host/types/remote.ts';
import { copyFact, joinCopies, projectOf } from './projectCopies.ts';

const here = (path: string, origin: string | null): Project => ({
  id: path,
  name: path.split('/').pop()!,
  path,
  origin,
  addedAt: 0,
  iconMode: 'none',
  icon: null,
  favicon: null,
  isMissing: false,
  favoriteOrder: null,
});

const there = (ref: string, origin: string | null): CatalogProject => ({
  ref,
  name: ref,
  origin,
  copy: { branch: 'main', changed: 0 },
});

const MOCHI = 'github.com/frstycodes/mochi';

test('copies with the same remote are one project, this computer’s first', () => {
  const joined = joinCopies(
    [here('/dev/mochi', MOCHI), here('/dev/notes', null)],
    [
      { machineId: 'pc', projects: [there('p1', MOCHI), there('p2', null)] },
      { machineId: 'box', projects: [there('b1', MOCHI)] },
    ],
  );
  assert.deepEqual(
    joined.map((p) => [p.name, p.copies.map((c) => c.machineId)]),
    [
      ['mochi', [null, 'pc', 'box']],
      ['notes', [null]],
      ['p2', ['pc']],
    ],
  );
});

test('a project only another computer holds lists with that copy alone', () => {
  const joined = joinCopies(
    [],
    [{ machineId: 'pc', projects: [there('p1', MOCHI)] }],
  );
  assert.equal(joined.length, 1);
  assert.equal(joined[0].copies[0].ref, 'p1');
  assert.deepEqual(joined[0].copies[0].status, { branch: 'main', changed: 0 });
});

test('a second clone on the same computer stays its own project', () => {
  const joined = joinCopies(
    [here('/dev/mochi', MOCHI), here('/tmp/mochi-2', MOCHI)],
    [{ machineId: 'pc', projects: [there('p1', MOCHI)] }],
  );
  assert.deepEqual(
    joined.map((p) => p.copies.map((c) => c.machineId)),
    [[null, 'pc'], [null]],
  );
});

test('no projects anywhere joins to nothing', () => {
  assert.deepEqual(joinCopies([], [{ machineId: 'pc', projects: [] }]), []);
});

test('projectOf finds a project by any of its copies', () => {
  const joined = joinCopies(
    [here('/dev/mochi', MOCHI)],
    [{ machineId: 'pc', projects: [there('p1', MOCHI)] }],
  );
  assert.equal(projectOf(joined, 'pc', 'p1'), joined[0]);
  assert.equal(projectOf(joined, null, '/dev/mochi'), joined[0]);
  assert.equal(projectOf(joined, 'pc', '/dev/mochi'), undefined);
  assert.equal(projectOf(joined, null, null), undefined);
});

test('copyFact says where a copy stands against its remote', () => {
  const at = (behind: number, ahead: number, changed = 0) => ({
    branch: 'main',
    changed,
    upstream: { ahead, behind },
  });
  assert.equal(copyFact(null, MOCHI), 'Plain folder, no git');
  assert.equal(copyFact(at(0, 0), MOCHI), 'Up to date with GitHub');
  assert.equal(
    copyFact(at(4, 1, 2), MOCHI),
    '4 commits to pull from GitHub, 1 commit not pushed, 2 changed files',
  );
  assert.equal(
    copyFact({ branch: 'wip', changed: 0 }, 'gitlab.com/a/b'),
    'Not pushed to GitLab',
  );
});
