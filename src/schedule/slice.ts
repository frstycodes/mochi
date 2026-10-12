import type { ScheduleEvent, ScheduleRun } from '../host/types/schedule.ts';
import type { QueueItem } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { log, mapThread } from '../store/threads.ts';

export type ScheduleAction = { type: 'schedule-run'; event: Extract<ScheduleEvent, { type: 'run-start' | 'run-end' }> };

/** A run from main: its start wakes the thread like a message you sent; its end lands in the thread's history and the Queue. */
export function scheduleReducer(state: State, action: Action): State {
  if (action.type !== 'schedule-run') return state;
  const { event } = action;
  const thread = state.threads.find((t) => t.id === event.run.threadId);
  if (!thread) return state;
  const now = state.now;
  if (event.type === 'run-start') {
    return {
      ...state,
      threads: mapThread(state.threads, thread.id, (t) => {
        const woken = { ...t, status: 'running' as const, settledAt: undefined, live: t.live && { ...t.live, isWorking: true, isDetached: undefined, limit: undefined } };
        return log(log(woken, { at: now, who: 'harness', kind: 'event', text: `Scheduled run: ${event.run.reason}` }), { at: now, who: 'you', kind: 'message', text: event.prompt });
      }),
    };
  }
  const item: QueueItem = { id: `q-${event.run.id}`, kind: 'run', threadId: thread.id, title: runTitle(event.name, event.run), detail: runDetail(event.run), blocks: { steps: 0, threads: 0 }, createdAt: now };
  return {
    ...state,
    threads: mapThread(state.threads, thread.id, (t) => log(t, { at: now, who: 'harness', kind: 'event', text: `Scheduled run ended: ${item.title}` })),
    queue: [...state.queue.filter((q) => q.id !== item.id), item],
  };
}

export const runTitle = (name: string, run: ScheduleRun) => `${name} ${runOutcome(run)}`;

/** "finished: 2 findings", "failed", … */
export function runOutcome(run: ScheduleRun) {
  if (run.status === 'running') return 'is running';
  if (run.status === 'done') return run.summary ? `finished: ${run.summary}` : 'finished';
  if (run.status === 'limited') return 'paused at the usage limit';
  if (run.status === 'interrupted') return 'was interrupted';
  if (run.status === 'skipped') return 'skipped';
  return 'failed';
}

function runDetail(run: ScheduleRun) {
  const took = run.endedAt ? Math.max(1, Math.round((run.endedAt - run.startedAt) / 60_000)) : null;
  const parts = [run.reason, took && `ran ${took} min`, run.error, run.resetsAt && `resumes after ${new Date(run.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`];
  return parts.filter(Boolean).join(' · ');
}
