import type { ActivityEntry, Author } from '../model.ts';
import type { Review } from '../secondOpinion/verdict.ts';
import { isTurnCall } from './mochiCalls.ts';
import type { TurnChanges } from './turnChanges.ts';

export type ChatRow =
  | { kind: 'message'; key: string; entry: ActivityEntry; index: number; showAuthor: boolean }
  | { kind: 'event'; key: string; entry: ActivityEntry }
  | { kind: 'work'; key: string; who: Author; entries: ActivityEntry[] }
  | { kind: 'review'; key: string; review: Review }
  /** An image a tool call made (`entry.generated`): its own card, never folded into a work group. */
  | { kind: 'image'; key: string; entry: ActivityEntry }
  /** The MCP App view a tool call declared (`entry.widget`), right after the call's group. */
  | { kind: 'widget'; key: string; entry: ActivityEntry }
  /** A subagent where it was started (`entry.subagentId`). */
  | { kind: 'subagent'; key: string; entry: ActivityEntry }
  /** A message another thread's agent sent (`entry.from`) or an Auto-fix event (`entry.autofix`): a line in the log, not a bubble. It still starts a turn like yours. */
  | { kind: 'thread-message'; key: string; entry: ActivityEntry; index: number }
  /** The files a finished turn changed, after its last row. */
  | { kind: 'changes'; key: string; turn: TurnChanges };

/**
 * Work groups interleave with prose like Claude's: the tool calls and reasoning between two messages (anyone's) are one
 * group, plus the events logged while the agent was mid-work (approvals, their answers, goal changes). Events before a
 * group's first work (drift tags on your message) or after prose stay rows of their own.
 */
export function chatRows(activity: ActivityEntry[], reviews: Review[] = [], changes: TurnChanges[] = []): ChatRow[] {
  const rows: ChatRow[] = [];
  let turn: Extract<ChatRow, { kind: 'work' }> | undefined;
  let isMidWork = false;
  const pushReviews = (at: number) => reviews.filter((r) => (at < activity.length ? r.afterIndex === at : r.afterIndex >= at)).forEach((review) => rows.push({ kind: 'review', key: review.id, review }));

  const pushChanges = (at: number) => changes.filter((t) => t.end === at - 1).forEach((turn) => rows.push({ kind: 'changes', key: `changes-${turn.start}`, turn }));

  activity.forEach((entry, i) => {
    pushChanges(i);
    pushReviews(i);
    const key = `${entry.at}-${i}`;
    // Like a subagent, a generated image stays in view: the turn goes on in a new group after it.
    if (entry.generated) {
      turn = undefined;
      return rows.push({ kind: 'image', key, entry });
    }
    if (entry.kind === 'tool' && isTurnCall(entry)) return;
    if (entry.kind === 'tool' || entry.kind === 'reasoning') {
      isMidWork = true;
      if (turn) turn.entries.push(entry);
      else rows.push((turn = { kind: 'work', key, who: entry.who, entries: [entry] }));
      if (!entry.widget) return;
      // The call stays in its group; its view stays in view after it, and the turn goes on in a new group.
      turn = undefined;
      return rows.push({ kind: 'widget', key: `${key}-widget`, entry });
    }
    // A subagent's row stays in view like a Mochi widget: the turn goes on in a new accordion after it.
    if (entry.kind === 'subagent') {
      turn = undefined;
      return rows.push({ kind: 'subagent', key, entry });
    }
    if (entry.kind === 'event') {
      const isWidget = !!entry.card || !!entry.isLimit || !!entry.compaction || !!entry.handoff || !!entry.nextMove || !!entry.subThread || !!entry.proposals;
      if (turn && isMidWork && !isWidget) return turn.entries.push(entry);
      // Mochi's widgets (a delete or settings approval, a usage limit, a compaction, a handoff, an answered next move, a sub-thread's result, thread cards) stay in view: the turn continues in a new accordion after one.
      if (isWidget) turn = undefined;
      return rows.push({ kind: 'event', key, entry });
    }
    turn = undefined;
    isMidWork = false;
    if (entry.from || entry.autofix) return rows.push({ kind: 'thread-message', key, entry, index: i });
    const previous = rows.findLast((r) => r.kind === 'work' || r.kind === 'message');
    const previousWho = previous?.kind === 'work' ? previous.who : previous?.kind === 'message' ? previous.entry.who : undefined;
    rows.push({ kind: 'message', key, entry, index: i, showAuthor: previousWho !== entry.who });
  });
  pushChanges(activity.length);
  pushReviews(activity.length);
  return rows;
}

/** The work row a running thread is still writing: the newest one, unless anyone has spoken since. */
export function liveWorkIndex(rows: ChatRow[]) {
  const i = rows.findLastIndex((r) => r.kind === 'work');
  return rows.slice(i + 1).some((r) => r.kind === 'message' || r.kind === 'thread-message') ? -1 : i;
}

/**
 * Agent replies that get message actions: the last agent message of each turn (nothing but events or reviews after it until
 * you speak), and in the newest turn only once the agent is idle. Your own messages always keep theirs.
 */
export function finalReplies(rows: ChatRow[], isWorking: boolean): Set<number> {
  const finals = new Set<number>();
  let candidate = -1;
  rows.forEach((row, i) => {
    if (row.kind === 'work' || row.kind === 'subagent' || row.kind === 'image') return void (candidate = -1);
    if (row.kind !== 'message' && row.kind !== 'thread-message') return;
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
