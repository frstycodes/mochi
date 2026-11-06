import type { Thread } from './model.ts';
import { idleVerdict } from './goals/verdict.ts';

/** When a snoozed thread wakes: "9:00 AM" today, "tomorrow 9:00 AM", else "Mon 9:00 AM". */
export function wakeLabel(at: number, now = new Date()) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === now.toDateString()) return time;
  if (date.toDateString() === tomorrow.toDateString())
    return `tomorrow ${time}`;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

const HOUR_MS = 3_600_000;

/** The Snooze menu's times: three hours on, tomorrow 9 AM, next Monday 9 AM. */
export function snoozeTimes(now = new Date()) {
  const morning = (daysAhead: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  };
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: 'Later today', at: now.getTime() + 3 * HOUR_MS },
    { label: 'Tomorrow', at: morning(1) },
    { label: 'Next week', at: morning(daysToMonday) },
  ];
}

/** Snoozed: it lists under Snoozed until it wakes (`wakeSnoozed`), not under Threads. */
export const isSnoozed = (thread: Pick<Thread, 'snoozedUntil'>) =>
  thread.snoozedUntil !== undefined;

/**
 * It asks for you, as its row says (`threadStatus`'s warning or destructive tone): it waits on your answer or approval, or a
 * live agent stopped on a question, an error or a usage limit.
 */
export function asksForYou(thread: Thread) {
  if (thread.status === 'needs-you') return true;
  const verdict = thread.live && idleVerdict(thread);
  return !!verdict && verdict.kind !== 'idle';
}

/**
 * `after`'s threads with each snooze that is over cleared: its time came (`nowMs`, wall clock), however long ago; it started
 * asking for you since `before`, whatever it was snoozed until; or it was settled or pinned, which a snooze doesn't outlast.
 * A thread woken by its time is left unread, so it reads as back. The same array when no snooze ended.
 */
export function wakeSnoozed(
  before: Thread[],
  after: Thread[],
  nowMs: number,
): Thread[] {
  if (!after.some(isSnoozed)) return after;
  let isChanged = false;
  const threads = after.map((t) => {
    const until = t.snoozedUntil;
    if (until === undefined) return t;
    const wasAsking = before.some((b) => b.id === t.id && asksForYou(b));
    const isDue = until !== 'needs-you' && until <= nowMs;
    if (
      !isDue &&
      (wasAsking || !asksForYou(t)) &&
      t.status !== 'settled' &&
      t.orbitSlot === undefined
    )
      return t;
    isChanged = true;
    const { snoozedUntil: _, ...awake } = t;
    return isDue && t.activity.length > 0
      ? {
          ...awake,
          seenActivity: Math.min(t.seenActivity ?? 0, t.activity.length - 1),
        }
      : awake;
  });
  return isChanged ? threads : after;
}
