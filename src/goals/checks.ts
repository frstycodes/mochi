import type { Dispatch } from 'react';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { CheckRun } from '../host/types/git.ts';
import type { Criterion, Thread } from '../model.ts';
import type { Action } from '../store/index.tsx';

/** Why a criterion's check can't run right now, or null when it can. */
export function checkBlockedReason(thread: Thread, criterion: Criterion, isDesktop = host.isDesktop) {
  if (!criterion.command) return 'This criterion has no command to run';
  if (criterion.check?.status === 'running') return 'The check is running';
  if (!thread.repo) return 'This chat has no project folder to run it in';
  // Running in the project folder would test someone else's checkout, not this thread's changes.
  if (isDesktop && thread.repo.mode !== 'folder' && !worktreePath(thread.id)) return "This thread's worktree hasn't been made yet";
  if (!threadCwd(thread, isDesktop)) return `${thread.repo.project} has no folder on this computer`;
  return null;
}

/** Runs a criterion's check in the thread's worktree; the result lands on the criterion and in the thread's log. */
export async function runCriterionCheck(dispatch: Dispatch<Action>, thread: Thread, criterion: Criterion, run: (cwd: string, command: string) => Promise<CheckRun> = host.git.runCheck) {
  const cwd = threadCwd(thread);
  if (checkBlockedReason(thread, criterion) || !cwd || !criterion.command) return;
  dispatch({ type: 'criterion-check', threadId: thread.id, criterionId: criterion.id, result: 'running' });
  const result = await run(cwd, criterion.command).catch((error: Error) => ({ exitCode: null, output: error.message, ms: 0 }));
  dispatch({ type: 'criterion-check', threadId: thread.id, criterionId: criterion.id, result });
}

