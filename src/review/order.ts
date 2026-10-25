import type { QueueItem, Thread } from '../model.ts';
import { isGoalMet } from '../goals/verdict.ts';

/** Threads in the space whose goal is met (or a demo thread in `review`), the longest-waiting review request first: the order review mode walks them. */
export function reviewThreads({
  threads,
  queue,
  spaceId,
}: {
  threads: Thread[];
  queue: QueueItem[];
  spaceId: string;
}) {
  const requestedAt = new Map(
    queue
      .filter((q) => q.kind === 'review')
      .map((q) => [q.threadId, q.createdAt]),
  );
  const rank = (t: Thread) => requestedAt.get(t.id) ?? Number.MAX_SAFE_INTEGER;
  return threads
    .filter(
      (t) => t.spaceId === spaceId && (t.status === 'review' || isGoalMet(t)),
    )
    .sort((a, b) => rank(a) - rank(b));
}

/** J/K and Skip wrap around the list; an approved thread leaves it, so the same index lands on the next one. */
export function stepIndex(index: number, count: number, step: 1 | -1) {
  if (count === 0) return 0;
  return (((index + step) % count) + count) % count;
}
