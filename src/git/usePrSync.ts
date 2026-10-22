import { useQueries } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useEffect, useRef, type Dispatch } from 'react';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import { worktreePath } from './worktrees.ts';
import type { Action } from '../store/index.tsx';

// The ref chips' freshness (`useRefState`): a focus within this of the last read reuses it.
const TTL_MS = 60_000;
const PUSHES_OR_OPENS = /\b(git\s+push|gh\s+pr)\b/;

interface RepoWorktrees {
  key: string;
  githubUser?: string;
  /** Worktree path → its thread. */
  worktrees: Map<string, string>;
}


/**
 * Records gh's PRs for every unsettled worktree thread's branch on `thread.prs`, so every surface reads one list: one `gh pr list`
 * per repo and account, at launch, on window focus past the TTL, and when a turn that pushed or ran `gh pr` ends. Nothing polls.
 */
export function usePrSync(threads: Thread[], dispatch: Dispatch<Action>) {
  const latest = useRef(threads);
  latest.current = threads;
  const repos = repoWorktrees(threads);
  const keys = repos.map((r) => r.key).join('\n');
  const prsQueries = useQueries({ queries: repos.map((repo) => ({ queryKey: queryKeys.git.worktreePrs(repo.key), queryFn: () => host.git.worktreePrs([...repo.worktrees.keys()], repo.githubUser), enabled: host.isDesktop, staleTime: TTL_MS })), combine: (results) => results.map((result) => result.data) });
  useEffect(() => {
    repos.forEach((repo, i) => {
      const found = prsQueries[i];
      if (!found) return;
      for (const [worktree, threadId] of repo.worktrees) {
        const prs = found.filter((f) => f.worktree === worktree).map((f) => f.pr);
        if (prs.length > 0) dispatch({ type: 'prs-seen', threadId, prs });
      }
    });
  }, [prsQueries, keys, dispatch]);

  useEffect(() => {
    if (!host.isDesktop) return;
    const pushed = new Set<string>();
    return host.agent.onEvent((event) => {
      if (event.type === 'tool' && event.phase === 'start' && PUSHES_OR_OPENS.test(event.text)) pushed.add(event.threadId);
      if (event.type !== 'turn-end' || !pushed.delete(event.threadId)) return;
      const repo = repoWorktrees(latest.current).find((r) => [...r.worktrees.values()].includes(event.threadId));
      if (repo) void queryClient.invalidateQueries({ queryKey: queryKeys.git.worktreePrs(repo.key) });
    });
  }, [dispatch]);
}

/**
 * Unsettled live threads in their own worktree, grouped by project and profile account. Main reads each worktree's branch, since
 * the agent may have switched from the one the thread was made on; a project folder thread's branch can be anyone's.
 */
function repoWorktrees(threads: Thread[]): RepoWorktrees[] {
  const profiles = getProfiles();
  const repos = new Map<string, RepoWorktrees>();
  for (const t of threads) {
    const worktree = worktreePath(t.id);
    if (!t.live || t.status === 'settled' || !t.repo?.path || !worktree) continue;
    const githubUser = profiles.find((p) => p.id === t.spaceId)?.github || undefined;
    const groupKey = `${t.repo.path}\u0000${githubUser ?? ''}`;
    const repo = repos.get(groupKey) ?? { key: groupKey, githubUser, worktrees: new Map() };
    repo.worktrees.set(worktree, t.id);
    repos.set(groupKey, repo);
  }
  // A new worktree in a repo is a new key, so it's read without waiting out the TTL.
  return [...repos.values()].map((r) => ({ ...r, key: `${r.key}\u0000${[...r.worktrees.keys()].sort().join(',')}` }));
}
