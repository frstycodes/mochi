import { plural } from '@mochi/domain/lib/format';
import type { Thread } from '../model.ts';
import { wallNow } from '../store/context.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `thread` settled now. `settledAt` is on the app clock, which stops while Mochi is closed, so `settledMs` keeps the wall clock too. */
export function markSettled(thread: Thread, now: number): Thread {
  return { ...thread, status: 'settled', settledAt: now, settledMs: wallNow() };
}

/**
 * When a settled thread settled, in wall-clock ms. Threads settled before `settledMs` was stamped fall back to their last
 * stamped activity; undefined when neither is known.
 */
export function settledMsOf(thread: Thread) {
  return (
    thread.settledMs ?? thread.activity.findLast((a) => a.ms !== undefined)?.ms
  );
}

/** Every word of `query` appears in the thread's title, branch or one of its PRs (number or title). */
export function matchesQuery(thread: Thread, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [
    thread.title,
    thread.repo?.branch,
    ...thread.prs.flatMap((pr) => [`#${pr.number}`, pr.title]),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

export interface SettledGroup {
  label: string;
  threads: Thread[];
}

/**
 * Settled threads (already sorted by `settledThreads` in `reorder.ts`) under Today, Yesterday, Previous 7 days, Previous 30 days, then one
 * heading per month (with its year when not this year), and Earlier for those with no known time. Days are local calendar days.
 */
export function groupByDate(threads: Thread[], now: number): SettledGroup[] {
  const groups: SettledGroup[] = [];
  for (const thread of threads) {
    const label = dateLabel(settledMsOf(thread), now);
    const last = groups.at(-1);
    if (last?.label === label) last.threads.push(thread);
    else groups.push({ label, threads: [thread] });
  }
  return groups;
}

function dateLabel(ms: number | undefined, now: number) {
  if (ms === undefined) return 'Earlier';
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  const date = new Date(ms);
  const isThisYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'long',
    ...(!isThisYear && { year: 'numeric' }),
  });
}

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Settled threads that Settings › General › Delete settled threads removes: settled more than `days` ago. A pinned thread,
 * one with an open or draft PR, and one whose settle time isn't known are always kept.
 */
export function dueForDelete(threads: Thread[], now: number, days: number) {
  return threads.filter((t) => {
    const ms = settledMsOf(t);
    return (
      t.status === 'settled' &&
      t.pinOrder === undefined &&
      !t.prs.some((pr) => pr.state === 'open' || pr.state === 'draft') &&
      ms !== undefined &&
      now - ms >= days * DAY_MS
    );
  });
}

/** "Delete “Fix login”?" or "Delete 3 threads?", for the confirm and the menu. */
export function deleteTitle(threads: Pick<Thread, 'title'>[]) {
  return plural(
    threads.length,
    `Delete “${threads[0]?.title}”?`,
    `Delete ${threads.length} threads?`,
  );
}
