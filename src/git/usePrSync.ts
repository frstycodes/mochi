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

const readAt = new Map<string, number>();

/**
 * Records gh's PRs for every unsettled worktree thread's branch on `thread.prs`, so every surface reads one list: one `gh pr list`
 * per repo and account, at launch, on window focus past the TTL, and when a turn that pushed or ran `gh pr` ends. Nothing polls.
 */
export function usePrSync(threads: Thread[], dispatch: Dispatch<Action>) {
  const latest = useRef(threads);
  latest.current = threads;
  const keys = repoWorktrees(threads)
    .map((r) => r.key)
    .join('\n');

  useEffect(() => {
    if (!host.isDesktop) return;
    readStale(latest.current, dispatch);
    const onFocus = () => readStale(latest.current, dispatch);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [keys, dispatch]);

  useEffect(() => {
    if (!host.isDesktop) return;
    const pushed = new Set<string>();
    return host.agent.onEvent((event) => {
      if (event.type === 'tool' && event.phase === 'start' && PUSHES_OR_OPENS.test(event.text)) pushed.add(event.threadId);
      if (event.type !== 'turn-end' || !pushed.delete(event.threadId)) return;
      const repo = repoWorktrees(latest.current).find((r) => [...r.worktrees.values()].includes(event.threadId));
      if (repo) read(repo, dispatch);
    });
  }, [dispatch]);
}

function readStale(threads: Thread[], dispatch: Dispatch<Action>) {
  for (const repo of repoWorktrees(threads)) if (Date.now() - (readAt.get(repo.key) ?? 0) > TTL_MS) read(repo, dispatch);
}

function read(repo: RepoWorktrees, dispatch: Dispatch<Action>) {
  readAt.set(repo.key, Date.now());
  void host.git.worktreePrs([...repo.worktrees.keys()], repo.githubUser).then((found) => {
    for (const [worktree, threadId] of repo.worktrees) {
      const prs = found.filter((f) => f.worktree === worktree).map((f) => f.pr);
      if (prs.length > 0) dispatch({ type: 'prs-seen', threadId, prs });
    }
  });
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
