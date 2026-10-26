import { useEffect, useRef } from 'react';
import { plural } from '@mochi/domain/lib/format';
import { toast } from '../toast/store.ts';
import { removeThreadWorktree } from '../git/worktrees.ts';
import { isListed } from '../model.ts';
import { usePrefs } from '../settings/prefs.ts';
import { useHarness } from '../store/index.tsx';
import { dueForDelete } from './settled.ts';

const CLEANUP_MS = 60 * 60 * 1000;

/** Deletes threads settled longer than Settings › General › Delete settled threads says, on launch and hourly, with their clean worktrees. */
export function useSettledCleanup() {
  const { state, dispatch } = useHarness();
  const { settledCleanup } = usePrefs();
  const threads = useRef(state.threads);
  useEffect(() => {
    threads.current = state.threads;
  }, [state.threads]);
  useEffect(() => {
    if (settledCleanup === 'never') return;
    const days = Number(settledCleanup);
    const run = () => {
      const due = dueForDelete(
        threads.current.filter(isListed),
        Date.now(),
        days,
      );
      if (due.length === 0) return;
      dispatch({ type: 'delete', threadIds: due.map((t) => t.id) });
      // Git refuses a dirty worktree, which stays on disk.
      for (const t of due) void removeThreadWorktree(t.id).catch(() => {});
      toast(
        plural(
          due.length,
          'Deleted a settled thread',
          `Deleted ${due.length} settled threads`,
        ),
        { description: `Settled more than ${days} days ago.` },
      );
    };
    run();
    const id = setInterval(run, CLEANUP_MS);
    return () => clearInterval(id);
  }, [settledCleanup, dispatch]);
}
