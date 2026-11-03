import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { CopyStatus } from './host/types/remote.ts';
import { placeNotes } from './PlaceNotes.tsx';
import type { ProjectCopy, ProjectWithCopies } from './projectCopies.ts';

const copy = (machineId: string | null, status: CopyStatus): ProjectCopy => ({
  machineId,
  ref: machineId ?? 'here',
  name: 'mochi',
  origin: 'github.com/frstycodes/mochi',
  icon: null,
  status,
});
const at = (branch: string, behind: number, ahead: number): CopyStatus => ({
  branch,
  changed: 0,
  upstream: { ahead, behind },
});
const NAMES = { pc: 'Windows PC', box: 'Linux box' } as Record<string, string>;

function notesFor(
  picked: ProjectCopy,
  others: ProjectCopy[],
  mode: 'worktree' | 'folder',
  startBranch = 'main',
) {
  const project: ProjectWithCopies = {
    key: 'k',
    name: 'mochi',
    origin: 'github.com/frstycodes/mochi',
    icon: null,
    copies: [picked, ...others],
  };
  return placeNotes({
    project,
    picked,
    mode,
    startBranch,
    statusOf: (c) => c.status,
    nameOf: (c) => (c.machineId ? NAMES[c.machineId] : 'MacBook Pro'),
  }).map((n) => [n.text, n.action?.label ?? null]);
}

test('a copy behind its remote says so with Pull, in the folder only', () => {
  const pc = copy('pc', at('main', 4, 0));
  assert.deepEqual(notesFor(pc, [], 'folder'), [
    [
      'Windows PC is 4 commits behind origin/main; the agent would start on older code.',
      'Pull on Windows PC',
    ],
  ]);
  assert.deepEqual(notesFor(pc, [], 'worktree'), []);
});

test('a diverged copy says so without a Pull, which would have to merge', () => {
  const [[text, action]] = notesFor(copy('pc', at('main', 2, 1)), [], 'folder');
  assert.match(text!, /has 1 commit of its own/);
  assert.equal(action, null);
});

test('another computer’s unpushed commits on the start branch offer Push from it, in either mode', () => {
  const picked = copy(null, at('main', 0, 0));
  const others = [copy('pc', at('main', 0, 2)), copy('box', at('dev', 0, 5))];
  const expected = [
    [
      'Windows PC has 2 commits on main that aren’t pushed; this thread won’t see them.',
      'Push from Windows PC',
    ],
  ];
  assert.deepEqual(notesFor(picked, others, 'worktree'), expected);
  assert.deepEqual(notesFor(picked, others, 'folder'), expected);
  assert.deepEqual(notesFor(picked, others, 'folder', 'dev'), [
    [
      'Linux box has 5 commits on dev that aren’t pushed; this thread won’t see them.',
      'Push from Linux box',
    ],
  ]);
});

test('a copy in step with its remote says nothing', () => {
  assert.deepEqual(
    notesFor(
      copy(null, at('main', 0, 0)),
      [copy('pc', at('main', 0, 0))],
      'folder',
    ),
    [],
  );
});
