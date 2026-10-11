import { useRef } from 'react';
import { toast } from 'sonner';
import { gitError } from '../git/useGit.ts';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { useHarness } from '../store/index.tsx';
import { checkpointPhrase } from './checkpoints.ts';

/** Rewind and undo touch the worktree first and the transcript only once the files are back, so the two never disagree. */
export function useRewindActions() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;

  const undo = async () => {
    const saved = latest.current.rewindUndo;
    if (!saved) return;
    const cwd = worktreePath(saved.threadId);
    try {
      if (saved.hasFiles && cwd) await host.git.restoreCheckpoint(cwd, saved.threadId, 'undo');
    } catch (error) {
      toast.error('Could not undo the rewind', { description: gitError(error) });
      return;
    }
    dispatch({ type: 'rewind-undo' });
    toast.success(`Undid the rewind of "${saved.thread.title}"`);
  };

  const rewind = async (thread: Thread, n: number) => {
    const checkpoint = latest.current.checkpoints[thread.id]?.find((c) => c.n === n);
    if (!checkpoint) return;
    const cwd = worktreePath(thread.id);
    try {
      if (checkpoint.ref && cwd) await host.git.restoreCheckpoint(cwd, thread.id, n);
    } catch (error) {
      toast.error('Rewind failed, nothing changed', { description: gitError(error) });
      return;
    }
    dispatch({ type: 'rewind', threadId: thread.id, n });
    toast.success(`Rewound "${thread.title}" to ${checkpointPhrase(checkpoint)}`, { action: { label: 'Undo', onClick: () => void undo() } });
  };

  return { rewind, undo };
}
