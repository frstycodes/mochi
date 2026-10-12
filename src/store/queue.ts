import { answerText, seedQueue, type QueueItem } from '../model.ts';
import type { Action, State } from './index.tsx';
import { getRestored } from './persist.ts';
import { showsDemoData } from '../demoData.ts';
import { hasOpenWork, log, mapStep, mapThread } from './threads.ts';

export interface QueueState {
  queue: QueueItem[];
}

/** `answers` is each question's picked labels and typed text, for question items. */
export type QueueAction =
  | { type: 'answer'; queueId: string; answers?: string[][] }
  /** A Mochi card (a consequential tool call or a setting) joins the queue; `queue-dismiss` takes it out without answering an agent request. */
  | { type: 'queue-add'; item: QueueItem }
  | { type: 'queue-dismiss'; queueId: string };

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
    case 'queue-dismiss':
      return { ...state, queue: state.queue.filter((q) => q.id !== action.queueId) };
    case 'delete':
      return { ...state, queue: state.queue.filter((q) => !action.threadIds.includes(q.threadId)) };
    default:
      return state;
  }
}

export function rankQueue(items: QueueItem[]) {
  const weight = (q: QueueItem) => q.blocks.steps * 2 + q.blocks.threads * 3 + (q.kind === 'overlap' ? 4 : 0);
  return [...items].sort((a, b) => weight(b) - weight(a) || a.createdAt - b.createdAt);
}

function answer(state: State, queueId: string, answers: string[][] = []): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item) return state;
  const now = state.now;
  const queue = state.queue.filter((q) => q.id !== queueId);

  const threads = mapThread(state.threads, item.threadId, (t) => {
    if (item.kind === 'review') {
      const prs = t.prs.map((p) => (p.state === 'open' ? { ...p, state: 'merged' as const } : p));
      const done = !hasOpenWork(t);
      return log({ ...t, prs, status: done ? 'settled' : t.status }, { at: now, who: 'you', kind: 'event', text: done ? 'Approved and merged. Every PR is merged, thread settled.' : 'Approved and merged' });
    }
    const blocked = t.steps.find((s) => s.status === 'blocked');
    const unblocked = blocked ? mapStep(t, blocked.id, (s) => ({ ...s, status: 'running', note: undefined })) : t;
    const text = item.kind === 'approval' ? `Approved: ${item.code ?? item.title}` : (answerText(answers) || 'Answered');
    return log({ ...unblocked, status: 'running' }, { at: now, who: 'you', kind: item.kind === 'approval' ? 'event' : 'message', text });
  });
  return { ...state, threads, queue };
}
