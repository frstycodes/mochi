import { useQueries } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toPullRequest } from '@mochi/core/github/nodes';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import { branchPrsQuery } from './githubWatch.ts';
import { worktreePath } from './worktrees.ts';
import { useDispatch, useHarnessSelector } from '../store/index.tsx';

interface WatchedWorktree {
  threadId: string;
  worktree: string;
  githubUser?: string;
}

/**
 * Records GitHub's PRs for every unsettled worktree thread's branch on `thread.prs`, so every surface reads one list. Each worktree
 * watches its branch through Core, which reads each repository once per poll for every surface on it. A turn that pushed or ran
 * `gh pr` makes Core read now and record what it finds itself: the reactor's `pr.refresh` (packages/core/src/reactor/hostWork.ts).
 */
export function usePrSync() {
  const watched = useHarnessSelector(
    (s) => watchedWorktrees(s.threads),
    isSameWatched,
  );
  const dispatch = useDispatch();
  const prs = useQueries({
    queries: watched.map((w) => ({
      ...branchPrsQuery(w.worktree, w.githubUser),
      enabled: host.isDesktop,
    })),
    combine: (results) => results.map((result) => result.data),
  });
  useEffect(() => {
    watched.forEach(({ threadId }, i) => {
      const found = prs[i]?.prs.map(toPullRequest);
      if (found?.length) dispatch({ type: 'prs-seen', threadId, prs: found });
    });
  }, [watched, prs, dispatch]);
}

const isSameWatched = (a: WatchedWorktree[], b: WatchedWorktree[]) =>
  a.length === b.length &&
  a.every(
    (w, i) =>
      w.threadId === b[i]!.threadId &&
      w.worktree === b[i]!.worktree &&
      w.githubUser === b[i]!.githubUser,
  );

/** Unsettled live threads in their own worktree. Core reads each worktree's branch, since the agent may have switched from the one the thread was made on. */
function watchedWorktrees(threads: Thread[]): WatchedWorktree[] {
  const profiles = getProfiles();
  return threads.flatMap((t) => {
    const worktree = worktreePath(t.id);
    if (!t.live || t.status === 'settled' || !t.repo?.path || !worktree)
      return [];
    return [
      {
        threadId: t.id,
        worktree,
        githubUser:
          profiles.find((p) => p.id === t.spaceId)?.github || undefined,
      },
    ];
  });
}
