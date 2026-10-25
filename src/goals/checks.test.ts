import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { setWorktreePath } from '../git/worktrees.ts';
import type { Criterion, Thread } from '../model.ts';
import type { Action } from '../store/index.tsx';
import { checkBlockedReason, runCriterionCheck } from './checks.ts';

const criterion: Criterion = {
  id: 'c1',
  text: 'Tests pass',
  command: 'pnpm test',
};
const thread = {
  id: 't-check',
  repo: { project: 'mochi', branch: 'fix/hover', path: '/repo' },
  criteria: [criterion],
} as Thread;

test('the check button says why it cannot run, and enables once the worktree exists', () => {
  assert.equal(
    checkBlockedReason(thread, { ...criterion, command: undefined }, true),
    'This criterion has no command to run',
  );
  assert.equal(
    checkBlockedReason({ ...thread, repo: null }, criterion, true),
    'This chat has no project folder to run it in',
  );
  assert.equal(
    checkBlockedReason(thread, criterion, true),
    "This thread's worktree hasn't been made yet",
  );
  assert.equal(
    checkBlockedReason(
      { ...thread, repo: { ...thread.repo!, mode: 'folder', path: undefined } },
      criterion,
      true,
    ),
    'mochi has no folder on this computer',
  );
  assert.equal(checkBlockedReason(thread, criterion, false), null);
  setWorktreePath(thread.id, '/worktrees/t-check');
  assert.equal(checkBlockedReason(thread, criterion, true), null);
  assert.equal(
    checkBlockedReason(
      thread,
      { ...criterion, check: { status: 'running', at: 0 } },
      true,
    ),
    'The check is running',
  );
});

test('running a check reports running, then the result, in the thread worktree', async () => {
  setWorktreePath(thread.id, '/worktrees/t-check');
  const actions: Action[] = [];
  const ran: string[] = [];
  await runCriterionCheck(
    (a) => actions.push(a),
    thread,
    criterion,
    async (cwd, command) => {
      ran.push(`${cwd} ${command}`);
      return { exitCode: 1, output: '1 failing', ms: 900 };
    },
  );
  assert.deepEqual(ran, ['/worktrees/t-check pnpm test']);
  assert.deepEqual(
    actions.map((a) => a.type === 'criterion-check' && a.result),
    ['running', { exitCode: 1, output: '1 failing', ms: 900 }],
  );
});
