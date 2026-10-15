import type { ActivityEntry } from '../model.ts';
import { toolCall } from '../summary.ts';

export interface TurnFile {
  path: string;
  added: number;
  removed: number;
  /** One unified diff per edit, in the order they were made; empty when the agent sent none. */
  patches: string[];
}

export interface TurnChanges {
  /** Activity index of your message that started the turn; -1 for work before your first message. */
  start: number;
  /** Activity index of the turn's last entry. */
  end: number;
  /** In the order each was first edited. */
  files: TurnFile[];
  added: number;
  removed: number;
  /** Ran a shell command, which may have changed files the log can't see: the turn's git diff says. */
  ranCommands: boolean;
}

/** Every turn (your message up to your next one) that edited files or ran commands, its files read from the edits the work log recorded. */
export function turnChanges(activity: ActivityEntry[]): TurnChanges[] {
  const turns: TurnChanges[] = [];
  let turn = emptyTurn(-1);
  const close = (end: number) => (turn.files.length > 0 || turn.ranCommands) && turns.push({ ...turn, end });
  activity.forEach((entry, i) => {
    if (isYourMessage(entry)) {
      close(i - 1);
      turn = emptyTurn(i);
      return;
    }
    if (isCommand(entry)) turn.ranCommands = true;
    for (const edit of fileEdits(entry)) {
      let file = turn.files.find((f) => f.path === edit.path);
      if (!file) turn.files.push((file = { path: edit.path, added: 0, removed: 0, patches: [] }));
      file.added += edit.added;
      file.removed += edit.removed;
      if (edit.patch) file.patches.push(edit.patch);
      turn.added += edit.added;
      turn.removed += edit.removed;
    }
  });
  close(activity.length - 1);
  return turns;
}

/** The turn still open at the end of the transcript (no message of yours after it), when it edited files. */
export function openTurn(activity: ActivityEntry[]) {
  const last = turnChanges(activity).at(-1);
  return last?.end === activity.length - 1 ? last : undefined;
}

/** Files of `turn` a later turn edited again: undoing `turn` puts them back to before it, so those later edits go too. */
export function editedLater(turns: TurnChanges[], turn: TurnChanges) {
  const later = new Set(turns.filter((t) => t.start > turn.start).flatMap((t) => t.files.map((f) => f.path)));
  return turn.files.map((f) => f.path).filter((path) => later.has(path));
}

/** Whether the turn's file changes are currently undone: the latest undo or redo logged for it says. */
export function isTurnUndone(activity: ActivityEntry[], start: number) {
  return activity.findLast((e) => e.turnUndo?.start === start)?.turnUndo?.isUndone ?? false;
}

/** A unified diff split per file (`@pierre/diffs`' PatchDiff throws on more than one); sections without a hunk (an empty file created) are dropped. */
export function patchSections(patch: string) {
  return patch.split(/^(?=diff --git )/m).filter((s) => /^@@/m.test(s));
}

const isYourMessage = (e: ActivityEntry) => e.who === 'you' && e.kind === 'message';

function emptyTurn(start: number): TurnChanges {
  return { start, end: start, files: [], added: 0, removed: 0, ranCommands: false };
}

const isCommand = (e: ActivityEntry) => e.kind === 'tool' && !e.skill && !e.mcp && toolCall(e).verb === 'Run';

/** One edit call as per-file changes: a patch spanning several files (Codex's file changes) splits at its `diff --git` headers. */
function fileEdits(entry: ActivityEntry) {
  if (entry.kind !== 'tool' || entry.skill || entry.mcp) return [];
  const call = toolCall(entry);
  if (call.verb !== 'Edit' && call.verb !== 'Write') return [];
  const sections = entry.patch?.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git ')) ?? [];
  if (!sections.length)
    return [
      {
        path: call.target,
        added: call.added ?? 0,
        removed: call.removed ?? 0,
        patch: entry.patch,
      },
    ];
  return sections.map((patch) => {
    const { added = 0, removed = 0 } = toolCall({ text: '', patch });
    // Claude's patches name the file by its base name only; the call's target has its path.
    const header = /^diff --git a\/.+ b\/(.+)$/m.exec(patch)?.[1];
    const path = !header || call.target === header || call.target.endsWith(`/${header}`) ? call.target : header;
    return { path, added, removed, patch };
  });
}
