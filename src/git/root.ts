import type { Thread } from '../model.ts';

/**
 * Where a thread works, as the thread itself records it: the folder its agent runs in, else its project's. The store's
 * folds read this; the renderer's `threadCwd` (src/host/cwd.ts) also knows this window's worktree paths.
 */
export const threadRoot = (thread: Pick<Thread, 'repo' | 'live'>) => thread.live?.cwd ?? thread.repo?.path ?? null;
