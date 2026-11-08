import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { toast } from '@/toast/store';
import { refreshRef } from '../chat/useRefState';
import { useThreadCalls } from '../remote/threadCalls';
import type { MergeMethod, MergeMode } from '../host/types/git';
import type { Thread } from '../model';
import { setPrefs, usePrefs } from '../settings/prefs';
import { checkTally, pickMethod, useMergeFlow } from './MergeButton';
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

  const [isConfirming, setConfirming] = useState(false);
  const checksQuery = useQuery({
    queryKey: queryKeys.git.review(calls?.key ?? '', pr.number),
    queryFn: () => calls!.prReview(pr.number),
    enabled: isConfirming && !!calls,
    refetchInterval: isConfirming ? 30_000 : false,
  });
  const review = checksQuery.data;
  const flow = useMergeFlow({
    head: review?.head ?? state.branch?.head ?? '',
    base: review?.base ?? state.branch?.base ?? '',
    tally:
      isConfirming && review
        ? checkTally(review.checks)
        : (state.checkCounts ?? NO_CHECKS),
    checks: review?.checks ?? (checksQuery.isSuccess ? [] : undefined),
    checksError: checksQuery.isError,
    onOpenChange: setConfirming,
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
