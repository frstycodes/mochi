import { turnDiffQuery } from './turnDiffQuery';
import { useQuery } from '@tanstack/react-query';
import { useWorktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';
import { turnCheckpoint } from '../rewind/checkpoints.ts';
import { useHarness } from '../store/index.tsx';
import type { TurnChanges } from './turnChanges.ts';

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
  const diffQuery = useQuery(turnDiffQuery(cwd, from, to, isLatest ? thread.activity.length : undefined));
  if (!diffQuery.data) return turn;
  const files = diffQuery.data.map((f) => ({ path: f.path, added: f.added, removed: f.removed, patches: f.patch ? [f.patch] : [] }));
  return { ...turn, files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}
