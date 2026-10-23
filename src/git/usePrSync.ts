import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef, type Dispatch } from 'react';
import { toPullRequest } from '@mochi/core/github/nodes';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import { branchPrsQuery, refreshGithub } from './githubWatch.ts';
import { worktreePath } from './worktrees.ts';
import type { Action } from '../store/index.tsx';

const PUSHES_OR_OPENS = /\b(git\s+push|gh\s+pr)\b/;

interface WatchedWorktree {
  threadId: string;
  worktree: string;
  githubUser?: string;
}

/**
 * Records GitHub's PRs for every unsettled worktree thread's branch on `thread.prs`, so every surface reads one list. Each worktree
 * watches its branch through Core, which reads each repository once per poll for every surface on it; a turn that pushed or ran
 * `gh pr` asks Core to read now and keep reading fast while CI runs.
 */
export function usePrSync(threads: Thread[], dispatch: Dispatch<Action>) {
  const latest = useRef(threads);
  latest.current = threads;
  const watched = watchedWorktrees(threads);
  const prs = useQueries({ queries: watched.map((w) => ({ ...branchPrsQuery(w.worktree, w.githubUser), enabled: host.isDesktop })), combine: (results) => results.map((result) => result.data) });
  useEffect(() => {
    watched.forEach(({ threadId }, i) => {
      const found = prs[i]?.prs.map(toPullRequest);
      if (found?.length) dispatch({ type: 'prs-seen', threadId, prs: found });
    });
  }, [prs, dispatch]);

  useEffect(() => {
    if (!host.isDesktop) return;
    const pushed = new Set<string>();
    return host.agent.onEvent((event) => {
      if (event.type === 'tool' && event.phase === 'start' && PUSHES_OR_OPENS.test(event.text)) pushed.add(event.threadId);
      if (event.type !== 'turn-end' || !pushed.delete(event.threadId)) return;
      const w = watchedWorktrees(latest.current).find((t) => t.threadId === event.threadId);
      if (w) refreshGithub({ cwd: w.worktree, githubUser: w.githubUser, isPush: true });
    });
  }, []);
}

/** Unsettled live threads in their own worktree. Core reads each worktree's branch, since the agent may have switched from the one the thread was made on. */
function watchedWorktrees(threads: Thread[]): WatchedWorktree[] {
  const profiles = getProfiles();
  return threads.flatMap((t) => {
    const worktree = worktreePath(t.id);
    if (!t.live || t.status === 'settled' || !t.repo?.path || !worktree) return [];
    return [{ threadId: t.id, worktree, githubUser: profiles.find((p) => p.id === t.spaceId)?.github || undefined }];
  });
}
