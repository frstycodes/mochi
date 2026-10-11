import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { projectRoot } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import { useHarness } from '../store/index.tsx';
import { setWorktreePath, worktreePath } from './worktrees.ts';

/** Creates a worktree for every thread with a folder created while the app runs; seeded fixture threads keep the project root. */
export function useWorktreeManager() {
  const { state } = useHarness();
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    known.current ??= new Set(state.threads.map((t) => t.id));
    for (const thread of state.threads) {
      if (known.current.has(thread.id)) continue;
      known.current.add(thread.id);
      if (!thread.repo || !host.isDesktop || worktreePath(thread.id)) continue;
      host.git
        .addWorktree(projectRoot(thread.repo.project), thread.id, thread.repo.branch)
        .then((path) => setWorktreePath(thread.id, path))
        .catch((error: Error) => toast.error(`Could not create a worktree for "${thread.title}"`, { description: error.message }));
    }
  }, [state.threads]);
}
