import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { projectRoot, threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import type { Fork } from '../rewind/fork.ts';
import { useCheckpointFiles } from '../rewind/useCheckpointFiles.ts';
import { useHarness } from '../store/index.tsx';
import { setWorktreePath, worktreePath } from './worktrees.ts';

/**
 * Creates a worktree for every thread with a folder created while the app runs; seeded fixture threads keep the project root.
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
      if (!thread.repo || !root || worktreePath(thread.id) || (!host.isDesktop && !fork)) continue;
      const created = fork ? forkWorktree(state.threads, thread, fork) : host.git.addWorktree(root, thread.id, thread.repo.branch);
      created
        .then((path) => setWorktreePath(thread.id, path))
        .catch((error: Error) => toast.error(`Could not create a worktree for "${thread.title}"`, { description: error.message }));
    }
  }, [state.threads, state.forks]);
}

function forkWorktree(threads: Thread[], thread: Thread, fork: Fork) {
  const parent = threads.find((t) => t.id === fork.parentId);
  const cwd = parent && threadCwd(parent);
  if (!cwd) return Promise.reject(new Error('The thread it was forked from has no folder'));
  const from = fork.checkpoint === undefined ? undefined : { threadId: fork.parentId, n: fork.checkpoint };
  return host.git.forkWorktree(cwd, thread.id, thread.repo!.branch, from);
}
