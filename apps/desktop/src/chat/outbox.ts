import type { Dispatch } from 'react';
import type { QueuedMessage, QueuePause, Thread } from '../model.ts';
import type { Action, State } from '../store/types.ts';
import { sendAction } from './queued.ts';

export {
  interruptsToSend,
  orderQueue,
  pauseQueue,
  queuedMessage,
  shouldQueue,
} from './queued.ts';

export const PAUSE_REASONS = {
  failed: 'The last turn failed',
  interrupted: 'The agent was stopped',
  limit: 'Usage limit reached',
  restart: 'Mochi restarted',
} satisfies Record<QueuePause, string>;

/** One step up (-1) or down (1); the ends stay put. */
export function moveQueued(ids: string[], id: string, step: -1 | 1) {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Send now on a message the agent hasn't read: takes it back, then every other unread one after it, so it goes out first once the
 * interrupted turn ends (`steer-requeue`). False when the agent already took it: it's delivered, so nothing is sent again and the
 * turn it started keeps running.
 */
export async function sendSteerNow(
  dispatch: Dispatch<Action>,
  thread: Thread,
  id: string,
  unsteer: (threadId: string, steerId: string) => Promise<boolean>,
) {
  dispatch({ type: 'steer-send-now', threadId: thread.id, id });
  const ids: string[] = [];
  try {
    if (await unsteer(thread.id, id)) {
      ids.push(id);
      for (const { message } of thread.steering ?? [])
        if (message.id !== id && (await unsteer(thread.id, message.id)))
          ids.push(message.id);
    }
  } finally {
    dispatch({ type: 'steer-requeue', threadId: thread.id, ids });
  }
  return ids.length > 0;
}

/**
 * Sends a message now: references resolve against the thread as it is at this moment, so a queued message reads them when it
 * goes out, not when you wrote it. It steers: a turn in flight takes it at its next step; an idle agent starts a turn with it.
 */
export function sendMessage(
  dispatch: Dispatch<Action>,
  state: Pick<State, 'threads'>,
  thread: Thread,
  message: QueuedMessage,
  extra?: { queuedId?: string },
) {
  dispatch(sendAction(state, thread, message, extra));
}
