import type { QueuedMessage, QueuePause, Thread } from '../model.ts';

export function pauseQueue(thread: Thread, reason: QueuePause): Thread {
  return thread.queued?.length ? { ...thread, queuePause: reason } : thread;
}

/** `ids` first in their order; anything they miss (queued meanwhile) keeps its place after them. */
export function orderQueue(queued: QueuedMessage[], ids: string[]) {
  const byId = new Map(queued.map((m) => [m.id, m]));
  return [...ids.flatMap((id) => byId.get(id) ?? []), ...queued.filter((m) => !ids.includes(m.id))];
}

/** Whether taking back `ids` (the clicked one first) stops the turn: only while the turn Send now was clicked in still runs. */
export function interruptsToSend(thread: Thread, ids: string[]) {
  const clicked = thread.steering?.find((s) => s.message.id === ids[0]);
  return !!thread.live?.isWorking && clicked?.sendNow === 'pending';
}
