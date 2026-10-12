import type { ActivityEntry, Author } from '../model.ts';
import type { Review } from '../secondOpinion/verdict.ts';

export type ChatRow =
  | { kind: 'message'; key: string; entry: ActivityEntry; index: number; showAuthor: boolean }
  | { kind: 'event'; key: string; entry: ActivityEntry }
  | { kind: 'work'; key: string; who: Author; entries: ActivityEntry[] }
  | { kind: 'review'; key: string; review: Review };

/**
 * One work row per turn (your message to the next): every tool call and reasoning of the turn, plus the events logged
 * while the agent was mid-work (approvals, their answers, goal changes). The agent's prose stays its own row, so work
 * after a paragraph still joins the turn's one row above it. Events before the turn's first work (drift tags on your
 * message) or after its prose stay rows of their own.
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
    if (entry.kind === 'event') {
      if (turn && isMidWork && !entry.card) return turn.entries.push(entry);
      // Mochi's widgets (a delete or settings approval) stay in view: the turn continues in a new accordion after one.
      if (entry.card) turn = undefined;
      return rows.push({ kind: 'event', key, entry });
    }
    if (entry.who === 'you') turn = undefined;
    isMidWork = false;
    const previous = rows.findLast((r) => r.kind === 'work' || r.kind === 'message');
    const previousWho = previous?.kind === 'work' ? previous.who : previous?.kind === 'message' ? previous.entry.who : undefined;
    rows.push({ kind: 'message', key, entry, index: i, showAuthor: previousWho !== entry.who });
  });
  pushReviews(activity.length);
  return rows;
}

/** The work row a running thread is still writing: the newest one, unless you've spoken since. */
export function liveWorkIndex(rows: ChatRow[]) {
  const i = rows.findLastIndex((r) => r.kind === 'work');
  return rows.slice(i + 1).some((r) => r.kind === 'message' && r.entry.who === 'you') ? -1 : i;
}
