import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { BranchList } from '../host/types/git.ts';
import { workspaceProblem } from './remoteWorkspace.ts';

const CHECKOUT = '/Users/me/mochi';
const LIST: BranchList = {
  current: 'main',
  defaultBranch: 'main',
  changes: { files: 0, added: 0, removed: 0 },
  branches: [
    { name: 'main', isRemote: false, committedAt: 3, worktree: CHECKOUT },
    { name: 'feat/x', isRemote: false, committedAt: 2 },
    {
      name: 'fix/y',
      isRemote: false,
      committedAt: 1,
      worktree: '/Users/me/.mochi/worktrees/y',
    },
    { name: 'origin/release', isRemote: true, committedAt: 0 },
  ],
};
const check = (workspace: Parameters<typeof workspaceProblem>[0]) =>
  workspaceProblem(workspace, LIST, CHECKOUT);

test('a new worktree starts from a base that exists here, on a branch name that doesn’t', () => {
  assert.equal(check({ mode: 'worktree' }), null);
  assert.equal(check({ mode: 'worktree', base: 'origin/release' }), null);
  assert.equal(check({ mode: 'worktree', branch: 'fix/new' }), null);
  assert.equal(
    check({ mode: 'worktree', base: 'origin/gone' }),
    'There’s no branch origin/gone here',
  );
  assert.equal(
    check({ mode: 'worktree', branch: 'feat/x' }),
    'feat/x already exists here; check it out instead',
  );
});

test('checking out a branch needs a local one no other checkout holds', () => {
  assert.equal(
    check({ mode: 'worktree', isExisting: true, branch: 'feat/x' }),
    null,
  );
  assert.equal(
    check({ mode: 'worktree', isExisting: true }),
    'Pick the branch to check out',
  );
  assert.equal(
    check({ mode: 'worktree', isExisting: true, branch: 'nope' }),
    'There’s no branch nope here',
  );
  assert.equal(
    check({ mode: 'worktree', isExisting: true, branch: 'main' }),
    `main is already checked out in ${CHECKOUT}`,
  );
  assert.match(
    check({ mode: 'worktree', isExisting: true, branch: 'fix/y' })!,
    /already checked out/,
  );
});

test('the project folder stays on its own branch or switches to a free one', () => {
  assert.equal(check({ mode: 'folder' }), null);
  assert.equal(check({ mode: 'folder', branch: 'main' }), null);
  assert.equal(check({ mode: 'folder', branch: 'feat/x' }), null);
  assert.match(
    check({ mode: 'folder', branch: 'fix/y' })!,
    /already checked out/,
  );
  assert.equal(
    check({ mode: 'folder', branch: 'origin/release' }),
    'There’s no branch origin/release here',
  );
});
