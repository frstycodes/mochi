import type { ActivityEntry, Author } from '../model.ts';
import type { Review } from '../secondOpinion/verdict.ts';
import { isTurnCall } from './mochiCalls.ts';
import type { TurnAnchor } from './turnAnchor.ts';
import type { TurnChanges } from './turnChanges.ts';
import { plural } from '@mochi/domain/lib/format';

export type ChatRow =
  | {
      kind: 'message';
      key: string;
      entry: ActivityEntry;
      index: number;
      showAuthor: boolean;
    }
  | { kind: 'event'; key: string; entry: ActivityEntry }
  | { kind: 'work'; key: string; who: Author; entries: ActivityEntry[] }
  /** Plan changes logged back to back (`planChange`): one line, opening to each. */
  | { kind: 'plan'; key: string; entries: ActivityEntry[] }
  | { kind: 'review'; key: string; review: Review }
  /** An image a tool call made (`entry.generated`): its own card, never folded into a work group. */
  | { kind: 'image'; key: string; entry: ActivityEntry }
  /** The MCP App view a tool call declared (`entry.widget`), right after the call's group. */
  | { kind: 'widget'; key: string; entry: ActivityEntry }
  /** Subagents where they were started (`entry.subagentId`), those started back to back as one row. */
  | { kind: 'subagent'; key: string; entries: ActivityEntry[] }
  /** A message another thread's agent sent (`entry.from`) or an Auto-fix event (`entry.autofix`): a line in the log, not a bubble. It still starts a turn like yours. */
  | { kind: 'thread-message'; key: string; entry: ActivityEntry; index: number }
  /** The files a finished turn changed, after its last row. */
  | { kind: 'changes'; key: string; turn: TurnChanges }
  /** The end-of-turn widgets kept on `anchor` while a newer turn runs, its answered next move (`record`) folded in. */
  | {
      kind: 'earlier-turn';
      key: string;
      anchor: TurnAnchor;
      record?: ActivityEntry['nextMove'];
    };

/**
 * Work groups interleave with prose like Claude's: the tool calls and reasoning between two messages (anyone's) are one
 * group, plus the events logged while the agent was mid-work (approvals, their answers). Events before a group's first
 * work or after prose stay rows of their own.
 */
export function chatRows(
  activity: ActivityEntry[],
  reviews: Review[] = [],
  changes: TurnChanges[] = [],
  earlier?: TurnAnchor,
): ChatRow[] {
  const rows: ChatRow[] = [];
  let turn: Extract<ChatRow, { kind: 'work' }> | undefined;
  let isMidWork = false;
  // A second opinion the agent asked for renders where its verdict went to the agent, in place of that message.
  const delivered = new Set(
    activity.flatMap((e) =>
      e.secondOpinion ? [e.secondOpinion.reviewId] : [],
    ),
  );
  const pushReview = (review: Review) =>
    rows.push({ kind: 'review', key: review.id, review });
  const pushReviews = (at: number) =>
    reviews
      .filter(
        (r) =>
          !delivered.has(r.id) &&
          (at < activity.length ? r.afterIndex === at : r.afterIndex >= at),
      )
      .forEach(pushReview);

  const pushChanges = (at: number) =>
    changes
      .filter((t) => t.end === at - 1)
      .forEach((turn) =>
        rows.push({ kind: 'changes', key: `changes-${turn.start}`, turn }),
      );
  const recordAt = earlier
    ? activity.findLastIndex(
        (e, i) => i > earlier.start && i <= earlier.end && !!e.nextMove,
      )
    : -1;
  const pushEarlier = (at: number) =>
    earlier?.end === at - 1 &&
    rows.push({
      kind: 'earlier-turn',
      key: `earlier-${earlier.start}`,
      anchor: earlier,
      record: activity[recordAt]?.nextMove,
    });

  activity.forEach((entry, i) => {
    pushChanges(i);
    pushEarlier(i);
    pushReviews(i);
    if (i === recordAt) return;
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
      else
        rows.push(
          (turn = { kind: 'work', key, who: entry.who, entries: [entry] }),
        );
      if (!entry.widget) return;
      // The call stays in its group; its view stays in view after it, and the turn goes on in a new group.
      turn = undefined;
      return rows.push({ kind: 'widget', key: `${key}-widget`, entry });
    }
    // A subagent's row stays in view like a Mochi widget: the turn goes on in a new accordion after it. Several started at once share it.
    if (entry.kind === 'subagent') {
      turn = undefined;
      const last = rows.at(-1);
      if (last?.kind === 'subagent') return last.entries.push(entry);
      return rows.push({ kind: 'subagent', key, entries: [entry] });
    }
    if (entry.kind === 'event') {
      const isWidget =
        !!entry.card ||
        !!entry.isLimit ||
        !!entry.compaction ||
        !!entry.handoff ||
        !!entry.nextMove ||
        !!entry.threadLink ||
        !!entry.subThread ||
        !!entry.subReport ||
        !!entry.proposals ||
        !!entry.grant ||
        !!entry.devServer;
      if (turn && isMidWork && !isWidget) return turn.entries.push(entry);
      // Mochi's widgets (a delete or settings approval, a usage limit, a compaction, a handoff, an answered next move, a sub-thread link, a sub-thread's result, a sub-thread's report, thread cards) stay in view: the turn continues in a new accordion after one.
      if (isWidget) turn = undefined;
      if (!planChange(entry)) return rows.push({ kind: 'event', key, entry });
      const last = rows.at(-1);
      if (last?.kind === 'plan') return last.entries.push(entry);
      return rows.push({ kind: 'plan', key, entries: [entry] });
    }
    turn = undefined;
    isMidWork = false;
    if (entry.secondOpinion) {
      const review = reviews.find(
        (r) => r.id === entry.secondOpinion!.reviewId,
      );
      return review && pushReview(review);
    }
    if (entry.from || entry.autofix)
      return rows.push({ kind: 'thread-message', key, entry, index: i });
    const previous = rows.findLast(
      (r) => r.kind === 'work' || r.kind === 'message',
    );
    const previousWho =
      previous?.kind === 'work'
        ? previous.who
        : previous?.kind === 'message'
          ? previous.entry.who
          : undefined;
    rows.push({
      kind: 'message',
      key,
      entry,
      index: i,
      showAuthor: previousWho !== entry.who,
    });
  });
  pushChanges(activity.length);
  pushEarlier(activity.length);
  pushReviews(activity.length);
  return rows;
}

// Matches the lines `src/runtime/apply.ts` logs when the agent's plan changes; parsed, so history logged before this reads the same.
const PLAN_EVENT =
  /^(?:Plan: \w+ (?:added "(?<added>.*)"|found (?<found>\d+) more steps)|\w+ dropped "(?<dropped>.*)")$/s;

/** How many steps a plan-change event added and dropped; undefined for any other entry. */
function planChange(entry: ActivityEntry) {
  const groups =
    entry.kind === 'event' && entry.who === 'harness'
      ? PLAN_EVENT.exec(entry.text)?.groups
      : undefined;
  if (!groups) return;
  return {
    added: groups.found
      ? Number(groups.found)
      : groups.added === undefined
        ? 0
        : 1,
    dropped: groups.dropped === undefined ? 0 : 1,
  };
}

/** "Plan updated: dropped 5 steps, added 3 steps" for a run of plan changes. */
export function planSummary(entries: ActivityEntry[]) {
  const changes = entries.map((e) => planChange(e)!);
  const dropped = changes.reduce((n, c) => n + c.dropped, 0);
  const added = changes.reduce((n, c) => n + c.added, 0);
  const steps = (n: number) => `${n} ${plural(n, 'step', 'steps')}`;
  return `Plan updated: ${[dropped && `dropped ${steps(dropped)}`, added && `added ${steps(added)}`].filter(Boolean).join(', ')}`;
}

/** The work row a running thread is still writing: the newest one, unless anyone has spoken since. */
export function liveWorkIndex(rows: ChatRow[]) {
  const i = rows.findLastIndex((r) => r.kind === 'work');
  return rows
    .slice(i + 1)
    .some((r) => r.kind === 'message' || r.kind === 'thread-message')
    ? -1
    : i;
}

/**
 * Agent replies that get message actions: the last agent message of each turn (nothing but events or reviews after it until
 * you speak), and in the newest turn only once the agent is idle. Your own messages always keep theirs.
 */
export function finalReplies(rows: ChatRow[], isWorking: boolean): Set<number> {
  const finals = new Set<number>();
  let candidate = -1;
  rows.forEach((row, i) => {
    if (row.kind === 'work' || row.kind === 'subagent' || row.kind === 'image')
      return void (candidate = -1);
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
