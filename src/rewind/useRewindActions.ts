import { useRef } from 'react';
import { toast } from '../toast/store.ts';
import { gitError } from '../git/useGit.ts';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { setPrefs } from '../settings/prefs.ts';
import { useHarness } from '../store/index.tsx';
import { sendToComposer } from '../browser/composer.tsx';
import { prunePins, restorePrunedPins } from '../chat/pins.ts';
import { checkpointPhrase, rewindBlockedReason, type RewindMode } from './checkpoints.ts';
import { rewindThread, type RewindTarget } from './run.ts';

export type { RewindTarget };

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

  /** Rewinding to one of your messages puts it back in the composer. */
  const rewind = async (thread: Thread, target: RewindTarget, mode: RewindMode) => {
    const done = await rewindThread(latest.current, dispatch, thread.id, target, mode);
    if (!done) return;
    if ('error' in done) return void toast.error(done.error, done.description ? { description: done.description } : undefined);
    setPrefs({ rewindMode: mode });
    const action = { label: 'Undo', onClick: () => void undo() };
    if (target.kind === 'checkpoint')
      return void toast.success(`Rewound "${thread.title}" to ${checkpointPhrase(done.checkpoint)}`, { description: modeNote(mode), action });
    prunePins(thread.id, target.index);
    const isYours = done.entry!.who === 'you';
    if (isYours) sendToComposer({ threadId: thread.id, text: done.entry!.text });
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
