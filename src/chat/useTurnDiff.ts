import { useEffect, useState } from 'react';
import { useWorktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { DiffFile } from '../host/types/git.ts';
import type { Thread } from '../model.ts';
import { turnCheckpoint } from '../rewind/checkpoints.ts';
import { useHarness } from '../store/index.tsx';
import type { TurnChanges } from './turnChanges.ts';

// Finished turns' diffs never change; keyed by both ends, so a turn diffed against the worktree re-reads once the thread moves on.
const diffs = new Map<string, Promise<DiffFile[]>>();

/**
 * The turn's changes as git sees them, from the checkpoint saved before its message to the one saved before your next (the worktree
 * now for the latest turn), so edits made through shell commands count too. The work log's edits until that's read, or without checkpoints.
 */
export function useTurnDiff(thread: Thread, turn: TurnChanges): TurnChanges {
  const { state } = useHarness();
  const cwd = useWorktreePath(thread.id);
  const list = state.checkpoints[thread.id] ?? [];
  const from = turnCheckpoint(list, turn.start)?.ref;
  const isLatest = turn.end === thread.activity.length - 1;
  // GAP: the latest turn diffs against the worktree, so your own edits after it ended count as its until you send again.
  const to = isLatest ? undefined : turnCheckpoint(list, turn.end + 1)?.ref;
  const key = cwd && from && (isLatest || to) ? `${cwd}:${from}:${to ?? `now@${thread.activity.length}`}` : null;
  const [loaded, setLoaded] = useState<{ key: string; files: DiffFile[] } | null>(null);

  useEffect(() => {
    if (!key || !cwd || !from) return;
    let isCurrent = true;
    if (!diffs.has(key)) diffs.set(key, host.git.turnDiff(cwd, from, to));
    diffs.get(key)!.then(
      (files) => isCurrent && setLoaded({ key, files }),
      (error) => {
        diffs.delete(key);
        console.warn('Could not read the turn diff', error);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [key, cwd, from, to]);

  if (!loaded || loaded.key !== key) return turn;
  const files = loaded.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed, patches: f.patch ? [f.patch] : [] }));
  return { ...turn, files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}
