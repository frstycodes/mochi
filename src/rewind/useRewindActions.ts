import { useRef } from 'react';
import { toast } from 'sonner';
import { gitError } from '../git/useGit.ts';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { setPrefs } from '../settings/prefs.ts';
import { useHarness } from '../store/index.tsx';
import { sendToComposer } from '../browser/composer.tsx';
import { prunePins, restorePrunedPins } from '../chat/pins.ts';
import { checkpointForMessage, checkpointPhrase, firstDroppedMessage, rewindBlockedReason, type RewindMode } from './checkpoints.ts';

/** A checkpoint (step boundary, timeline) or just before one of the thread's messages. */
export type RewindTarget = { kind: 'checkpoint'; n: number } | { kind: 'message'; index: number };

/** Rewind and undo touch the worktree first and the transcript only once the files are back, so the two never disagree. */
export function useRewindActions() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;
  const blocked = (threadId: string) => {
    const thread = latest.current.threads.find((t) => t.id === threadId);
    const reason = thread && rewindBlockedReason(thread);
    if (reason) toast.error(reason);
    return !!reason;
  };

  const undo = async () => {
    const saved = latest.current.rewindUndo;
    if (!saved || blocked(saved.threadId)) return;
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

  /**
   * `chat`: transcript, steps and the agent's session go back; `files`: the worktree too, Claude's own file checkpoints first so
   * the git restore after it has the last word. Rewinding to one of your messages puts it back in the composer.
   */
  const rewind = async (thread: Thread, target: RewindTarget, mode: RewindMode) => {
    if (blocked(thread.id)) return;
    const s = latest.current;
    const current = s.threads.find((t) => t.id === thread.id) ?? thread;
    const checkpoint = target.kind === 'message' ? checkpointForMessage(s, thread.id, target.index) : s.checkpoints[thread.id]?.find((c) => c.n === target.n);
    const entry = target.kind === 'message' ? current.activity[target.index] : undefined;
    if (!checkpoint || (target.kind === 'message' && !entry)) return;
    const dropped = firstDroppedMessage(current, target.kind === 'message' ? target.index : checkpoint.thread.activity.length);
    // Read before the rewind stops the agent: main only knows the point while the session is live.
    const forkAt = dropped && current.live ? await host.agent.rewindPoint(thread.id, dropped.text).catch(() => null) : undefined;
    const cwd = worktreePath(thread.id);
    if (mode === 'files' && checkpoint.ref && cwd) {
      try {
        // The undo snapshot comes first: Claude's own rewind below already changes files.
        await host.git.checkpoint(cwd, thread.id, 'undo');
        if (dropped) await host.agent.rewindFiles(thread.id, dropped.text).catch((error) => console.warn('Claude file rewind failed', error));
        await host.git.restoreCheckpoint(cwd, thread.id, checkpoint.n, true);
      } catch (error) {
        toast.error('Rewind failed, nothing changed', { description: gitError(error) });
        return;
      }
    }
    dispatch(target.kind === 'message' ? { type: 'rewind-message', threadId: thread.id, index: target.index, mode, forkAt } : { type: 'rewind', threadId: thread.id, n: target.n, mode, forkAt });
    setPrefs({ rewindMode: mode });
    const action = { label: 'Undo', onClick: () => void undo() };
    if (target.kind === 'checkpoint') return void toast.success(`Rewound "${thread.title}" to ${checkpointPhrase(checkpoint)}`, { description: modeNote(mode), action });
    prunePins(thread.id, target.index);
    const isYours = entry!.who === 'you';
    if (isYours) sendToComposer({ threadId: thread.id, text: entry!.text });
    toast.success(isYours ? 'Rewound to before your message' : 'Rewound to before this message', {
      description: [modeNote(mode), isYours && 'It is back in the composer to edit and send again.'].filter(Boolean).join(' '),
      action,
    });
  };

  return { rewind, undo };
}

function modeNote(mode: RewindMode) {
  return mode === 'files' ? 'Chat and files went back.' : 'Chat went back, files stayed.';
}
