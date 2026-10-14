import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { projectRoot, threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import type { Fork } from '../rewind/fork.ts';
import { useCheckpointFiles } from '../rewind/useCheckpointFiles.ts';
import { useHarness } from '../store/index.tsx';
import { setWorktreePath, worktreePath } from './worktrees.ts';
import { dueForCleanup } from './cleanup.ts';
import { recoverCheckouts } from './recovery.ts';
import { usePrefs } from '../settings/prefs.ts';

/**
 * Creates a worktree for every thread with a folder created while the app runs; seeded fixture threads keep the project root.
 * A live thread's worktree is made by main in `agent.start`, so the agent starts in it.
 * A fork's worktree starts from its parent's checkpoint, so forks get one in the web build too (from the mock).
 */
export function useWorktreeManager() {
  const { state } = useHarness();
  const known = useRef<Set<string> | null>(null);
  useCheckpointFiles();
  useEffect(() => {
    known.current ??= new Set(state.threads.map((t) => t.id));
    for (const thread of state.threads) {
      if (known.current.has(thread.id)) continue;
      known.current.add(thread.id);
      const fork = state.forks[thread.id];
      const root = thread.repo && projectRoot(thread.repo);
      if (!thread.repo || !root || (thread.repo.mode === 'folder' && !fork) || (thread.live && !fork) || worktreePath(thread.id) || (!host.isDesktop && !fork)) continue;
      const created = fork ? forkWorktree(state.threads, thread, fork) : host.git.addWorktree(root, thread.id, thread.repo.branch, { base: thread.repo.base, isExisting: thread.repo.isExisting });
      created
        .then((path) => setWorktreePath(thread.id, path))
        .catch((error: Error) => toast.error(`Could not create a worktree for "${thread.title}"`, { description: error.message }));
    }
  }, [state.threads, state.forks]);
}

/** Once per launch: threads pick up the worktree and branch their checkout really has (`recoverCheckouts`). */
export function useCheckoutRecovery() {
  const { state, dispatch } = useHarness();
  const threads = useRef(state.threads);
  useEffect(() => {
    if (!host.isDesktop) return;
    void recoverCheckouts(threads.current, worktreePath, host.git).then((found) => {
      for (const { threadId, head, worktree } of found) {
        if (worktree) setWorktreePath(threadId, worktree);
        dispatch({ type: 'repo-head', threadId, head, ...(worktree && { worktree }) });
      }
    });
  }, [dispatch]);
}

function forkWorktree(threads: Thread[], thread: Thread, fork: Fork) {
  const parent = threads.find((t) => t.id === fork.parentId);
  const cwd = parent && threadCwd(parent);
  if (!cwd) return Promise.reject(new Error('The thread it was forked from has no folder'));
  const from = fork.checkpoint === undefined ? undefined : { threadId: fork.parentId, n: fork.checkpoint };
  return host.git.forkWorktree(cwd, thread.id, thread.repo!.branch, from);
}

const SEEN_KEY = 'mochi.worktrees.settled';
const CLEANUP_MS = 60 * 60 * 1000;

/** Removes worktrees of threads settled longer than Settings › Git says, on launch and hourly. Git refuses a dirty one, which stays. */
export function useWorktreeCleanup() {
  const { state } = useHarness();
  const { worktreeCleanup } = usePrefs();
  const threads = useRef(state.threads);
  useEffect(() => {
    threads.current = state.threads;
  }, [state.threads]);
  useEffect(() => {
    if (!host.isDesktop || worktreeCleanup === 'never') return;
    const run = () => void cleanUp(threads.current, Number(worktreeCleanup));
    run();
    const id = setInterval(run, CLEANUP_MS);
    return () => clearInterval(id);
  }, [worktreeCleanup]);
}

async function cleanUp(threads: Thread[], days: number) {
  const { due, seen } = dueForCleanup(threads, Object.fromEntries(threads.flatMap((t) => (worktreePath(t.id) ? [[t.id, worktreePath(t.id)!]] : []))), loadSeen(), Date.now(), days);
  for (const { threadId, path } of due) {
    try {
      await host.git.removeWorktree(path);
      setWorktreePath(threadId, null);
      delete seen[threadId];
    } catch (error) {
      // Uncommitted changes: git keeps the worktree, and so do we.
      console.info(`Kept the worktree ${path}`, error);
    }
  }
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {}
}

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
  } catch {
    return {};
  }
}
