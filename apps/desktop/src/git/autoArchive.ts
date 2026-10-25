import { useEffect } from 'react';
import { useHarness } from '../store';
import { toggleSettle } from '../useSettle';
import { isArchiveDue } from './prs.ts';

/**
 * Archives each thread as it comes due, with the usual undo toast. Its PRs' Auto-archive goes off first, so an Undo sticks.
 * GAP: a PR's merge reaches `thread.prs` from Auto-fix's poll in main or the next window focus (`usePrSync`), so with Auto-fix off and
 * the window in the background it waits for that focus.
 */
export function useAutoArchive() {
  const { state, dispatch } = useHarness();
  useEffect(() => {
    for (const thread of state.threads.filter(isArchiveDue)) {
      for (const pr of thread.prs.filter((p) => p.autoArchive))
        dispatch({
          type: 'auto-archive-set',
          threadId: thread.id,
          pr: pr.number,
          isOn: false,
        });
      toggleSettle([thread], dispatch);
    }
  }, [state.threads, dispatch]);
}
