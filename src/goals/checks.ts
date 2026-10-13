import { useCallback, type Dispatch } from 'react';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { Criterion, Thread } from '../model';
import type { Action } from '../store';

/** Runs a criterion's check in the thread's worktree; the result lands on the criterion and in the thread's log. */
export function useRunCheck(dispatch: Dispatch<Action>) {
  return useCallback(
    async (thread: Thread, criterion: Criterion) => {
      const cwd = threadCwd(thread);
      if (!cwd || !criterion.command) return;
      dispatch({ type: 'criterion-check', threadId: thread.id, criterionId: criterion.id, result: 'running' });
      const result = await host.git.runCheck(cwd, criterion.command).catch((error: Error) => ({ exitCode: null, output: error.message, ms: 0 }));
      dispatch({ type: 'criterion-check', threadId: thread.id, criterionId: criterion.id, result });
    },
    [dispatch],
  );
}
