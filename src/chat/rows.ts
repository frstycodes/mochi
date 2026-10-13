import type { ActivityEntry, Author } from '../model.ts';
import type { Review } from '../secondOpinion/verdict.ts';

export type ChatRow =
  | { kind: 'message'; key: string; entry: ActivityEntry; index: number; showAuthor: boolean }
  | { kind: 'event'; key: string; entry: ActivityEntry }
  | { kind: 'work'; key: string; who: Author; entries: ActivityEntry[] }
  | { kind: 'review'; key: string; review: Review }
  /** A subagent where it was started (`entry.subagentId`). */
  | { kind: 'subagent'; key: string; entry: ActivityEntry };

/**
 * Work groups interleave with prose like Claude's: the tool calls and reasoning between two messages (anyone's) are one
 * group, plus the events logged while the agent was mid-work (approvals, their answers, goal changes). Events before a
 * group's first work (drift tags on your message) or after prose stay rows of their own.
 */
export function chatRows(activity: ActivityEntry[], reviews: Review[] = []): ChatRow[] {
  const rows: ChatRow[] = [];
  let turn: Extract<ChatRow, { kind: 'work' }> | undefined;
  let isMidWork = false;
  const pushReviews = (at: number) => reviews.filter((r) => (at < activity.length ? r.afterIndex === at : r.afterIndex >= at)).forEach((review) => rows.push({ kind: 'review', key: review.id, review }));

  activity.forEach((entry, i) => {
    pushReviews(i);
    const key = `${entry.at}-${i}`;
    if (entry.kind === 'tool' || entry.kind === 'reasoning') {
      isMidWork = true;
      if (turn) return turn.entries.push(entry);
      turn = { kind: 'work', key, who: entry.who, entries: [entry] };
      return rows.push(turn);
    }
    // A subagent's row stays in view like a Mochi widget: the turn goes on in a new accordion after it.
    if (entry.kind === 'subagent') {
      turn = undefined;
      return rows.push({ kind: 'subagent', key, entry });
    }
    if (entry.kind === 'event') {
      if (turn && isMidWork && !entry.card) return turn.entries.push(entry);
      // Mochi's widgets (a delete or settings approval) stay in view: the turn continues in a new accordion after one.
      if (entry.card) turn = undefined;
      return rows.push({ kind: 'event', key, entry });
    }
    turn = undefined;
    isMidWork = false;
    const previous = rows.findLast((r) => r.kind === 'work' || r.kind === 'message');
    const previousWho = previous?.kind === 'work' ? previous.who : previous?.kind === 'message' ? previous.entry.who : undefined;
    rows.push({ kind: 'message', key, entry, index: i, showAuthor: previousWho !== entry.who });
  });
  pushReviews(activity.length);
  return rows;
}

/** The work row a running thread is still writing: the newest one, unless anyone has spoken since. */
export function liveWorkIndex(rows: ChatRow[]) {
  const i = rows.findLastIndex((r) => r.kind === 'work');
  return rows.slice(i + 1).some((r) => r.kind === 'message') ? -1 : i;
}

/**
 * Agent replies that get message actions: the last agent message of each turn (nothing but events or reviews after it until
 * you speak), and in the newest turn only once the agent is idle. Your own messages always keep theirs.
 */
export function finalReplies(rows: ChatRow[], isWorking: boolean): Set<number> {
  const finals = new Set<number>();
  let candidate = -1;
  rows.forEach((row, i) => {
    if (row.kind === 'work' || row.kind === 'subagent') return void (candidate = -1);
    if (row.kind !== 'message') return;
    if (row.entry.who === 'you') {
      if (candidate >= 0) finals.add(candidate);
      candidate = -1;
      return;
    }
    if (row.entry.who === 'claude' || row.entry.who === 'codex') candidate = i;
  });
  if (candidate >= 0 && !isWorking) finals.add(candidate);
  return finals;
}
