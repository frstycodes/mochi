import { useState } from 'react';
import { toast } from '@/toast/store';
import { refreshRef } from '../chat/useRefState';
import { useThreadCalls } from '../remote/threadCalls';
import type { MergeMethod, MergeMode } from '../host/types/git';
import type { Thread } from '../model';
import { setPrefs, usePrefs } from '../settings/prefs';
import { pickMethod, useMergeFlow } from './MergeButton';
import { gitError } from './useGit';
import { useGithubScope, type ThreadPr } from './useThreadPrs';

/**
 * Merging one of a thread's PRs from its row, with the method last used; null unless it's open and its repository's merge
 * methods are known. Render `dialog` outside the row's hover card or menu.
 */
export function useThreadPrMerge(thread: Thread, item: ThreadPr) {
  const scope = useGithubScope(thread);
  const calls = useThreadCalls(thread);
  const { mergeMethod } = usePrefs();
  const [isBusy, setBusy] = useState(false);
  const { state, pr, githubRef, label } = item;

  const merge = async (method: MergeMethod, mode: MergeMode) => {
    if (!calls) return;
    setPrefs({ mergeMethod: method });
    setBusy(true);
    try {
      await calls.prAct(pr.number, { kind: 'merge', method, mode });
      toast.success(
        mode === 'auto'
          ? `${label} merges once its checks pass`
          : `Merged ${label}`,
      );
      if (githubRef)
        refreshRef(
          githubRef,
          scope,
          mode === 'auto' ? { isAutoMerge: true } : { status: 'merged' },
        );
    } catch (error) {
      toast.error(`Couldn’t merge ${label}`, { description: gitError(error) });
    } finally {
      setBusy(false);
    }
  };

  const flow = useMergeFlow({
    head: state.branch?.head ?? '',
    base: state.branch?.base ?? '',
    tally: state.checkCounts ?? NO_CHECKS,
    onMerge: merge,
  });
  const allowed = state.mergeMethods ?? [];
  if (state.status !== 'open' || allowed.length === 0 || !calls) return null;
  return {
    ...flow,
    allowed,
    method: pickMethod(allowed, mergeMethod),
    setMethod: (method: MergeMethod) => setPrefs({ mergeMethod: method }),
    isBusy,
    isConflicting: state.hasConflicts,
  };
}

const NO_CHECKS = { failed: 0, running: 0 };
