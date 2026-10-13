import { useSyncExternalStore, type Dispatch } from 'react';
import { isWorking } from '../agentPhase.ts';
import { judgeDrift, type DriftVerdict } from '../drift.ts';
import type { QueuedMessage, QueuePause, Thread } from '../model.ts';
import type { Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { withReferences } from './mentions.ts';
import { heldBy } from '../runtime/limits.ts';

type WhileWorking = Prefs['whileWorking'];

export const PAUSE_REASONS = {
  failed: 'The last turn failed',
  interrupted: 'The agent was stopped',
  limit: 'Usage limit reached',
  restart: 'Mochi restarted',
} satisfies Record<QueuePause, string>;

/** Whether a message sent now waits for the turn to end: the setting, flipped for this one send while mod is held. */
export function shouldQueue(thread: Thread, whileWorking: WhileWorking, isHeld: boolean) {
  return isWorking(thread) && (whileWorking === 'queue') !== isHeld;
}

/** The head of each live thread's queue whose agent is idle, not paused and not waiting on your answer. */
export function dueQueued(state: Pick<State, 'threads' | 'queue'>): { thread: Thread; message: QueuedMessage }[] {
  return state.threads.flatMap((thread) => {
    const message = thread.queued?.[0];
    if (!message || !thread.live || thread.queuePause || thread.live.isWorking || thread.live.starting || thread.status === 'settled') return [];
    if (heldBy(state.threads, thread)) return [];
    if (state.queue.some((q) => q.threadId === thread.id && (q.kind === 'approval' || q.kind === 'question'))) return [];
    return [{ thread, message }];
  });
}

export function pauseQueue(thread: Thread, reason: QueuePause): Thread {
  return thread.queued?.length ? { ...thread, queuePause: reason } : thread;
}

/** `ids` first in their order; anything they miss (queued meanwhile) keeps its place after them. */
export function orderQueue(queued: QueuedMessage[], ids: string[]) {
  const byId = new Map(queued.map((m) => [m.id, m]));
  return [...ids.flatMap((id) => byId.get(id) ?? []), ...queued.filter((m) => !ids.includes(m.id))];
}

/** One step up (-1) or down (1); the ends stay put. */
export function moveQueued(ids: string[], id: string, step: -1 | 1) {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

let nextId = 0;

export function queuedMessage(draft: string, fields: Omit<QueuedMessage, 'id' | 'draft'>): QueuedMessage {
  return { id: `m-${Date.now().toString(36)}-${nextId++}`, draft, ...fields };
}

/**
 * Sends a message now: references resolve and the drift guard judges it against the thread as it is at this moment, so a
 * queued message is checked when it goes out, not when you wrote it. A confident off-goal verdict waits in `useDriftPending`.
 */
export function sendMessage(dispatch: Dispatch<Action>, state: Pick<State, 'threads'>, thread: Thread, message: QueuedMessage, extra?: { queuedId?: string; interrupts?: boolean }) {
  const { draft, files } = message;
  const withFiles = files ? `${draft}${draft ? ' ' : ''}(${files} attached)` : draft;
  const { text, ...references } = withReferences(withFiles, message.mentions, state.threads, { isCommand: message.isCommand, provider: thread.providers[0], typedSkills: message.typedSkills });
  // A new message answers an open suggestion by ignoring it.
  setDriftPending(thread.id, null);
  const verdict = judgeDrift(text, thread);
  const isSettled = !(verdict instanceof Promise);
  dispatch({ type: 'send', threadId: thread.id, text, drift: isSettled && verdict.kind !== 'off-goal' ? verdict.kind : undefined, reason: isSettled ? verdict.reason : 'Checking against the goal', ...references, ...extra });
  void Promise.resolve(verdict).then((v) => {
    if (v.kind === 'off-goal') return setDriftPending(thread.id, { text, verdict: v });
    if (!isSettled) dispatch({ type: 'drift-verdict', threadId: thread.id, text, drift: v.kind, reason: v.reason });
  });
}

export interface DriftPending {
  text: string;
  verdict: DriftVerdict;
}

// Outside React: a queued message the store sends while its thread is closed still leaves its suggestion for when you open it.
const pendingDrift = new Map<string, DriftPending>();
const listeners = new Set<() => void>();

export function setDriftPending(threadId: string, pending: DriftPending | null) {
  if (pending) pendingDrift.set(threadId, pending);
  else if (!pendingDrift.delete(threadId)) return;
  listeners.forEach((l) => l());
}

export function useDriftPending(threadId: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pendingDrift.get(threadId) ?? null,
  );
}
