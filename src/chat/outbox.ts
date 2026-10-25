import type { Dispatch } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { DriftVerdict } from '../drift.ts';
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
 * Sends a message now: references resolve and the drift guard judges it against the thread as it is at this moment, so a
 * queued message is checked when it goes out, not when you wrote it. A confident off-goal verdict waits in `useDriftPending`.
 * It steers: a turn in flight takes it at its next step; an idle agent starts a turn with it.
 */
export function sendMessage(
  dispatch: Dispatch<Action>,
  state: Pick<State, 'threads'>,
  thread: Thread,
  message: QueuedMessage,
  extra?: { queuedId?: string },
) {
  // A new message answers an open suggestion by ignoring it.
  setDriftPending(thread.id, null);
  const { action, text, verdict } = sendAction(state, thread, message, extra);
  dispatch(action);
  void Promise.resolve(verdict).then((v) => {
    if (v.kind === 'off-goal')
      return setDriftPending(thread.id, { text, verdict: v });
    if (verdict instanceof Promise)
      dispatch({
        type: 'drift-verdict',
        threadId: thread.id,
        text,
        drift: v.kind,
        reason: v.reason,
      });
  });
}

export interface DriftPending {
  text: string;
  verdict: DriftVerdict;
}

// Outside React: a queued message the store sends while its thread is closed still leaves its suggestion for when you open it.
const driftStore = createStore<Record<string, DriftPending>>(() => ({}));

export function setDriftPending(
  threadId: string,
  pending: DriftPending | null,
) {
  if (pending) return driftStore.setState({ [threadId]: pending });
  if (!(threadId in driftStore.getState())) return;
  driftStore.setState(({ [threadId]: _, ...rest }) => rest, true);
}

export function useDriftPending(threadId: string) {
  return useStore(driftStore, (all) => all[threadId] ?? null);
}

export const driftPending = (threadId: string) =>
  driftStore.getState()[threadId] ?? null;
