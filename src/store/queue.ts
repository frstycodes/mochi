import { answerText, seedQueue, type QueueItem } from '../model.ts';
import type { Action, State } from './index.tsx';
import { getRestored } from './persist.ts';
import { showsDemoData } from '../demoData.ts';
import { log, mapStep, mapThread } from './threads.ts';

export interface QueueState {
  queue: QueueItem[];
}

/** `answers` is each question's picked labels and typed text, for question items. */
export type QueueAction =
  | { type: 'answer'; queueId: string; answers?: string[][] }
  /** A Mochi widget (a delete, a setting change, a browser escalation, or a setting a blocked call points at) joins the queue. */
  | { type: 'queue-add'; item: QueueItem }
  /** Closes a Mochi widget: the card leaves the queue and its place in the thread becomes the one-line `text`. */
  | { type: 'card-record'; queueId: string; text: string };

export function initialQueue(saved = getRestored(), isDemo = showsDemoData()): QueueState {
  return { queue: [...(isDemo ? seedQueue() : []), ...(saved?.queue ?? [])] };
}

export function queueReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'answer':
      return answer(state, action.queueId, action.answers);
    case 'queue-add':
      // The same card again (a setting card from a later blocked call) replaces the old one in place.
      return state.queue.some((q) => q.id === action.item.id) ? { ...state, queue: state.queue.map((q) => (q.id === action.item.id ? action.item : q)) } : { ...state, queue: [...state.queue, action.item] };
    case 'card-record':
      return {
        ...state,
        queue: state.queue.filter((q) => q.id !== action.queueId),
        threads: state.threads.map((t) =>
          t.activity.some((a) => a.card?.id === action.queueId) ? { ...t, activity: t.activity.map((a) => (a.card?.id === action.queueId ? { ...a, text: action.text, card: { id: action.queueId, isOpen: false } } : a)) } : t,
        ),
      };
    case 'delete':
      return { ...state, queue: state.queue.filter((q) => !action.threadIds.includes(q.threadId)) };
    default:
      return state;
  }
}

export function rankQueue(items: QueueItem[]) {
  const weight = (q: QueueItem) => q.blocks.steps * 2 + q.blocks.threads * 3;
  return [...items].sort((a, b) => weight(b) - weight(a) || a.createdAt - b.createdAt);
}

function answer(state: State, queueId: string, answers: string[][] = []): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item) return state;
  const now = state.now;
  const queue = state.queue.filter((q) => q.id !== queueId);
  if (item.kind === 'collision') return { ...state, queue, threads: mapThread(state.threads, item.threadId, (t) => log(t, { at: now, who: 'you', kind: 'event', text: 'Kept both threads editing the same files' })) };
  if (item.kind === 'run' || item.kind === 'ci') return { ...state, queue, threads: mapThread(state.threads, item.threadId, (t) => log(t, { at: now, who: 'you', kind: 'event', text: `Settled: ${item.title}` })) };

  const threads = mapThread(state.threads, item.threadId, (t) => {
    // PR state is GitHub's: marking done never touches it.
    if (item.kind === 'review') return log({ ...t, status: 'settled', settledAt: now }, { at: now, who: 'you', kind: 'event', text: 'Marked done' });
    const blocked = t.steps.find((s) => s.status === 'blocked');
    const unblocked = blocked ? mapStep(t, blocked.id, (s) => ({ ...s, status: 'running', note: undefined })) : t;
    const text = item.kind === 'approval' ? `Approved: ${item.code ?? item.title}` : (answerText(answers) || 'Answered');
    return log({ ...unblocked, status: 'running' }, { at: now, who: 'you', kind: item.kind === 'approval' ? 'event' : 'message', text });
  });
  return { ...state, threads, queue };
}
