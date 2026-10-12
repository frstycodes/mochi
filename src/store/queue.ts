import { seedQueue, type QueueItem } from '../model.ts';
import type { Action, State } from './index.tsx';
import { getRestored } from './persist.ts';
import { showsDemoData } from '../demoData.ts';
import { hasOpenWork, log, mapStep, mapThread } from './threads.ts';

export interface QueueState {
  queue: QueueItem[];
}

export type QueueAction = { type: 'answer'; queueId: string; choice?: string };

export function initialQueue(saved = getRestored(), isDemo = showsDemoData()): QueueState {
  return { queue: [...(isDemo ? seedQueue() : []), ...(saved?.queue ?? [])] };
}

export function queueReducer(state: State, action: Action): State {
  if (action.type === 'answer') return answer(state, action.queueId, action.choice);
  return state;
}

export function rankQueue(items: QueueItem[]) {
  const weight = (q: QueueItem) => q.blocks.steps * 2 + q.blocks.threads * 3 + (q.kind === 'overlap' ? 4 : 0);
  return [...items].sort((a, b) => weight(b) - weight(a) || a.createdAt - b.createdAt);
}

function answer(state: State, queueId: string, choice?: string): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item) return state;
  const now = state.now;
  const queue = state.queue.filter((q) => q.id !== queueId);
  const label = item.choices?.find((c) => c.id === choice)?.label;

  const threads = mapThread(state.threads, item.threadId, (t) => {
    if (item.kind === 'review') {
      const prs = t.prs.map((p) => (p.state === 'open' ? { ...p, state: 'merged' as const } : p));
      const done = !hasOpenWork(t);
      return log({ ...t, prs, status: done ? 'settled' : t.status }, { at: now, who: 'you', kind: 'event', text: done ? 'Approved and merged. Every PR is merged, thread settled.' : 'Approved and merged' });
    }
    const blocked = t.steps.find((s) => s.status === 'blocked');
    const unblocked = blocked ? mapStep(t, blocked.id, (s) => ({ ...s, status: 'running', note: undefined })) : t;
    const text = item.kind === 'approval' ? `Approved: ${item.code ?? item.title}` : (label ?? 'Answered');
    return log({ ...unblocked, status: 'running' }, { at: now, who: 'you', kind: item.kind === 'approval' ? 'event' : 'message', text });
  });
  return { ...state, threads, queue };
}
