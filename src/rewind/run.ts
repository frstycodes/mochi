import type { Dispatch } from 'react';
import { gitError } from '../git/useGit.ts';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Action, State } from '../store/index.tsx';
import type { ActivityEntry } from '../model.ts';
import {
  checkpointForMessage,
  firstDroppedMessage,
  rewindBlockedReason,
  type Checkpoint,
  type RewindMode,
} from './checkpoints.ts';

/** A checkpoint (step boundary, timeline) or just before one of the thread's messages. */
export type RewindTarget =
  | { kind: 'checkpoint'; n: number }
  | { kind: 'message'; index: number };

type RewindOutcome =
  | { error: string; description?: string }
  | { checkpoint: Checkpoint; entry?: ActivityEntry };

/**
 * `chat`: transcript, steps and the agent's session go back; `files`: the worktree too, Claude's own file checkpoints first so
 * the git restore after it has the last word. Null when there is nothing to rewind to there; an error when nothing changed.
 */
export async function rewindThread(
  state: State,
  dispatch: Dispatch<Action>,
  threadId: string,
  target: RewindTarget,
  mode: RewindMode,
): Promise<RewindOutcome | null> {
  const current = state.threads.find((t) => t.id === threadId);
  if (!current) return null;
  const reason = rewindBlockedReason(current);
  if (reason) return { error: reason };
  const checkpoint =
    target.kind === 'message'
      ? checkpointForMessage(state, threadId, target.index)
      : state.checkpoints[threadId]?.find((c) => c.n === target.n);
  const entry =
    target.kind === 'message' ? current.activity[target.index] : undefined;
  if (!checkpoint || (target.kind === 'message' && !entry)) return null;
  const dropped = firstDroppedMessage(
    current,
    target.kind === 'message'
      ? target.index
      : checkpoint.thread.activity.length,
  );
  // Read before the rewind stops the agent: main only knows the point while the session is live.
  const forkAt =
    dropped && current.live
      ? await host.agent.rewindPoint(threadId, dropped.text).catch(() => null)
      : undefined;
  const cwd = worktreePath(threadId);
  if (mode === 'files' && checkpoint.ref && cwd) {
    try {
      // The undo snapshot comes first: Claude's own rewind below already changes files.
      await host.git.checkpoint(cwd, threadId, 'undo');
      if (dropped)
        await host.agent
          .rewindFiles(threadId, dropped.text)
          .catch((error) => console.warn('Claude file rewind failed', error));
      await host.git.restoreCheckpoint(cwd, threadId, checkpoint.n, true);
    } catch (error) {
      return {
        error: 'Rewind failed, nothing changed',
        description: gitError(error),
      };
    }
  }
  dispatch(
    target.kind === 'message'
      ? {
          type: 'rewind-message',
          threadId,
          index: target.index,
          mode,
          forkAt,
          ms: Date.now(),
        }
      : { type: 'rewind', threadId, n: target.n, mode, forkAt, ms: Date.now() },
  );
  return { checkpoint, entry };
}
