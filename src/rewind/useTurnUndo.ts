import { useState } from 'react';
import { toast } from '../toast/store.ts';
import { gitError } from '../git/useGit.ts';
import { useWorktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { useHarness } from '../store/index.tsx';
import {
  editedLater,
  isTurnUndone,
  turnChanges,
  type TurnChanges,
} from '../chat/turnChanges.ts';
import { excerpt, rewindBlockedReason, turnCheckpoint } from './checkpoints.ts';
import { useLatest } from '../useLatest.ts';

/** What undoing the turn would also take back: later turns' edits to the same files, and changes made outside the agent since its last turn. */
export interface UndoConflicts {
  later: string[];
  outside: string[];
}

/**
 * Undo for one turn's file changes ("files only": the transcript and the agent's session stay). Only that turn's files go back,
 * each to how the checkpoint saved just before the turn's message held it; anything else in the worktree is left alone.
 */
export function useTurnUndo(thread: Thread, turn: TurnChanges) {
  const { state, dispatch } = useHarness();
  const cwd = useWorktreePath(thread.id);
  const [conflicts, setConflicts] = useState<UndoConflicts | null>(null);
  const [isPending, setPending] = useState(false);
  const latest = useLatest(thread);
  const checkpoint = turnCheckpoint(
    state.checkpoints[thread.id] ?? [],
    turn.start,
  );
  const isUndone = isTurnUndone(thread.activity, turn.start);
  const reason = rewindBlockedReason(thread)
    ? 'Stop the agent to undo'
    : !cwd
      ? NO_WORKTREE
      : !checkpoint?.ref
        ? NOT_SAVED
        : undefined;
  const paths = turn.files.map((f) =>
    cwd && f.path.startsWith(`${cwd}/`) ? f.path.slice(cwd.length + 1) : f.path,
  );
  const what = `${turn.files.length === 1 ? '1 file' : `${turn.files.length} files`} from ${turn.start < 0 ? 'the first turn' : `"${excerpt(thread.activity[turn.start].text)}"`}`;

  const restore = async (n: number | 'undo', isUndone: boolean) => {
    if (!cwd || rewindBlockedReason(latest.current)) return false;
    try {
      await host.git.restoreFiles(cwd, thread.id, n, paths);
    } catch (error) {
      toast.error(
        isUndone
          ? 'Could not undo the changes, nothing changed'
          : 'Could not put the changes back',
        { description: gitError(error) },
      );
      return false;
    }
    dispatch({
      type: 'turn-undo',
      threadId: thread.id,
      start: turn.start,
      isUndone,
      text: `${isUndone ? 'Undid' : 'Put back'} the changes to ${what}`,
    });
    return true;
  };

  const run = async () => {
    setConflicts(null);
    if (!checkpoint || !(await restore(checkpoint.n, true))) return;
    toast.success(`Undid the changes to ${what}`, {
      description: 'The chat stays as it is.',
      action: {
        label: 'Undo',
        onClick: () =>
          void restore('undo', false).then(
            (ok) => ok && toast.success(`Put back the changes to ${what}`),
          ),
      },
    });
  };

  /** Asks first when the undo would also take back edits made after this turn; otherwise undoes right away. */
  const request = async () => {
    if (reason || !cwd || !checkpoint || isPending) return;
    setPending(true);
    const later = editedLater(turnChanges(thread.activity), turn);
    // Unreadable reads as nothing changed outside: the later-turn check above still asks when it should.
    const changed = await host.git
      .rewindPreview(cwd, thread.id, checkpoint.n)
      .then(
        (p) => p.outside,
        (): string[] => [],
      );
    setPending(false);
    const outside = paths.filter(
      (p) => changed.includes(p) && !later.includes(p),
    );
    if (later.length || outside.length) return setConflicts({ later, outside });
    await run();
  };

  return {
    reason,
    isUndone,
    isPending,
    conflicts,
    request,
    run,
    cancel: () => setConflicts(null),
  };
}

const NO_WORKTREE =
  'This thread works in the project folder, not a worktree of its own, so its files have no saved checkpoints';
const NOT_SAVED = 'The files from before this turn weren’t saved';
