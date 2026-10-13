import type { ScheduleEvent, ScheduleRun } from '../host/types/schedule.ts';
import type { QueueItem } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { ciTitle } from '../notify/watch.ts';
import { log, mapThread } from '../store/threads.ts';

export type ScheduleAction = { type: 'schedule-run'; event: Extract<ScheduleEvent, { type: 'run-start' | 'run-end' }> } | { type: 'ci-result'; event: Extract<ScheduleEvent, { type: 'ci' }> };

/** A run from main: its start wakes the thread like a message you sent; its end lands in the thread's history and the Queue. */
export function scheduleReducer(state: State, action: Action): State {
  if (action.type === 'ci-result') return ciResult(state, action.event);
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

/** A watched thread's PR checks settled (main polls them): a pass is logged, a failure also lands in the Queue, once per failure. */
function ciResult(state: State, { threadId, result }: Extract<ScheduleEvent, { type: 'ci' }>): State {
  if (!state.threads.some((t) => t.id === threadId)) return state;
  const now = state.now;
  const title = ciTitle(result);
  const threads = mapThread(state.threads, threadId, (t) => log(t, { at: now, who: 'harness', kind: 'event', text: title }));
  if (result.status === 'pass') return { ...state, threads };
  const [check] = result.failed;
  const item: QueueItem = {
    id: `q-ci-${threadId}-${result.pr}-${Date.now().toString(36)}`,
    kind: 'ci',
    threadId,
    title,
    detail: result.failed.length > 1 ? `Failed: ${result.failed.map((c) => c.name).join(', ')}` : '',
    ci: { pr: result.pr, url: result.url, check: check && { name: check.name, link: check.link } },
    blocks: { steps: 0, threads: 0 },
    createdAt: now,
  };
  // A newer failure on the same PR replaces the card instead of stacking.
  return { ...state, threads, queue: [...state.queue.filter((q) => !(q.kind === 'ci' && q.threadId === threadId && q.ci?.pr === result.pr)), item] };
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
  const ms = run.endedAt ? run.endedAt - run.startedAt : null;
  const took = ms === null ? null : ms < 60_000 ? 'ran under a minute' : `ran ${Math.round(ms / 60_000)} min`;
  const parts = [run.reason, took, run.error, run.resetsAt && `resumes after ${new Date(run.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`];
  return parts.filter(Boolean).join(' · ');
}
