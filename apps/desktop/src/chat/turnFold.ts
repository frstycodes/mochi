import type { ActivityEntry } from '../model.ts';
import type { ChatRow } from './rows.ts';

export function foldTurns(
  rows: ChatRow[],
  activity: ActivityEntry[],
  isRunning: boolean,
  toggled: ReadonlySet<string>,
): ChatRow[] {
  const starts = rows.flatMap((r, i) => (startsTurn(r) ? [i] : []));
  if (!starts.length) return rows;
  const out = rows.slice(0, starts[0]);
  starts.forEach((s, k) => {
    const start = rows[s] as TurnStart;
    const next = starts[k + 1];
    const body = rows.slice(s + 1, next);
    const isLive = isRunning && next === undefined;
    const final = isLive
      ? body.length
      : body.findLastIndex((r) => r.kind === 'message' && isAgent(r));
    const folded = body.slice(0, Math.max(final, 0));
    out.push(start);
    if (!folded.length && !isLive) return out.push(...body);
    const key = `worked-${start.key}`;
    const isOpen = !toggled.has(key);
    const end =
      activity[
        (next === undefined
          ? activity.length
          : (rows[next] as TurnStart).index) - 1
      ];
    out.push({
      kind: 'worked',
      key,
      isOpen,
      ...(isLive
        ? start.entry.ms !== undefined && { startMs: start.entry.ms }
        : { durationMs: span(start.entry, end) }),
    });
    out.push(...(isOpen ? folded : folded.filter(isWaitingOnYou)));
    out.push(...body.slice(folded.length));
  });
  return out;
}

type TurnStart = Extract<ChatRow, { kind: 'message' | 'thread-message' }>;

const startsTurn = (r: ChatRow): r is TurnStart =>
  (r.kind === 'message' || r.kind === 'thread-message') &&
  r.entry.who === 'you' &&
  r.entry.kind === 'message';

const isAgent = (r: Extract<ChatRow, { kind: 'message' }>) =>
  r.entry.who === 'claude' || r.entry.who === 'codex';

const isWaitingOnYou = (r: ChatRow) =>
  r.kind === 'event' && !!r.entry.card?.isOpen;

/** Wall-clock when both ends were stamped; else the app's minute clock (`at`), which is all older entries have. */
const span = (from: ActivityEntry, to: ActivityEntry) =>
  from.ms !== undefined && to.ms !== undefined
    ? to.ms - from.ms
    : (to.at - from.at) * 60_000;
