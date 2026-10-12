import { useRef } from 'react';
import { toast } from 'sonner';
import { gitError } from '../git/useGit.ts';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { useHarness } from '../store/index.tsx';
import { sendToComposer } from '../browser/composer.tsx';
import { prunePins, restorePrunedPins } from '../chat/pins.ts';
import { checkpointForMessage, checkpointPhrase } from './checkpoints.ts';

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
    restorePrunedPins(saved.threadId);
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

  /** Back to just before one of your messages, which goes back into the composer to edit and resend (Claude Code's rewind). */
  const rewindToMessage = async (thread: Thread, index: number) => {
    const entry = thread.activity[index];
    const checkpoint = checkpointForMessage(latest.current, thread.id, index);
    if (!entry || !checkpoint) return;
    const cwd = worktreePath(thread.id);
    // Claude's own checkpoints first, so the git restore after it has the last word on the files.
    if (entry.who === 'you') await host.agent.rewindFiles(thread.id, entry.text).catch((error) => console.warn('Claude file rewind failed', error));
    try {
      if (checkpoint.ref && cwd) await host.git.restoreCheckpoint(cwd, thread.id, checkpoint.n);
    } catch (error) {
      toast.error('Rewind failed, nothing changed', { description: gitError(error) });
      return;
    }
    dispatch({ type: 'rewind-message', threadId: thread.id, index });
    prunePins(thread.id, index);
    if (entry.who === 'you') sendToComposer({ threadId: thread.id, text: entry.text });
    toast.success(entry.who === 'you' ? 'Rewound to before your message' : 'Rewound to before this message', {
      description: entry.who === 'you' ? 'It is back in the composer to edit and send again.' : undefined,
      action: { label: 'Undo', onClick: () => void undo() },
    });
  };

  return { rewind, rewindToMessage, undo };
}
