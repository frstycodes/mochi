import type { Thread } from '../model.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Worktrees of threads settled more than `days` ago. A thread's settle time is when cleanup first saw it settled (`seen`,
 * wall-clock ms): `settledAt` is on the app clock, which stops while Mochi is closed. Returns the next `seen` too, holding only
 * threads still settled with a worktree.
 */
export function dueForCleanup(threads: Pick<Thread, 'id' | 'status'>[], paths: Record<string, string>, seen: Record<string, number>, now: number, days: number) {
  const next: Record<string, number> = {};
  const due: { threadId: string; path: string }[] = [];
  for (const t of threads) {
    const path = paths[t.id];
    if (t.status !== 'settled' || !path) continue;
    next[t.id] = seen[t.id] ?? now;
    if (now - next[t.id] >= days * DAY_MS) due.push({ threadId: t.id, path });
  }
  return { due, seen: next };
}
