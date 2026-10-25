import type { QueueItem, Thread } from '../model.ts';
import type { State } from './types.ts';

/** Opened, here or on another device: the thread's activity so far and its open asks; or Queue cards looked at. Owned by the thread's computer. */
export type SeenAction = {
  type: 'seen';
  threadId?: string;
  queueIds?: string[];
};

const hasUnseen = (thread: Thread) =>
  thread.activity.length > (thread.seenActivity ?? 0);

/** Something landed in the thread since you last had it open, counted once its turn ends, not on every message mid-turn. */
export const isUnread = (thread: Thread) =>
  !thread.live?.isWorking && hasUnseen(thread);

export const isQueueUnread = (item: QueueItem) => !item.isSeen;

/** Same state when nothing was unread, so a repeat costs no store change. */
export function markSeen(
  state: State,
  { threadId, queueIds = [] }: SeenAction,
): State {
  const isMarked = (q: QueueItem) =>
    !q.isSeen && (q.threadId === threadId || queueIds.includes(q.id));
  const thread = state.threads.find((t) => t.id === threadId);
  // Unseen, not unread: opening a working thread still catches up on what it said so far.
  const isThreadMarked = !!thread && hasUnseen(thread);
  const hasQueue = state.queue.some(isMarked);
  if (!isThreadMarked && !hasQueue) return state;
  return {
    ...state,
    threads: isThreadMarked
      ? state.threads.map((t) =>
          t === thread ? { ...t, seenActivity: t.activity.length } : t,
        )
      : state.threads,
    queue: hasQueue
      ? state.queue.map((q) => (isMarked(q) ? { ...q, isSeen: true } : q))
      : state.queue,
  };
}
