import { duration } from '../progress.ts';
import type { ScheduleEvent, ScheduleRun } from '../host/types/schedule.ts';
import type { PullRequest, QueueItem, Thread } from '../model.ts';
import type { Action, State } from '../store/types.ts';
import {
  autofixBody,
  autofixPrompt,
  autofixTitle,
  type AutofixEvent,
} from '../git/autofix.ts';
import { ciTitle } from '../notify/watch.ts';
import {
  prEscalation,
  reportPr,
  reportPrsEnded,
} from '../runtime/subThreadReports.ts';
import { log, mapThread, send } from '../store/threads.ts';

export type ScheduleAction =
  | {
      type: 'schedule-run';
      event: Extract<ScheduleEvent, { type: 'run-start' | 'run-end' }>;
    }
  | { type: 'ci-result'; event: Extract<ScheduleEvent, { type: 'ci' }> }
  | { type: 'autofix'; threadId: string; event: AutofixEvent }
  /** `since` unset turns Auto-fix off for the PR; set, on from then, and the agent hears so once. */
  | { type: 'autofix-set'; threadId: string; pr: number; since?: number }
  | { type: 'auto-archive-set'; threadId: string; pr: number; isOn: boolean };

/** A run from main: its start wakes the thread like a message you sent; its end lands in the thread's history and the Queue. */
export function scheduleReducer(state: State, action: Action): State {
  if (action.type === 'ci-result') return ciResult(state, action.event);
  if (action.type === 'autofix')
    return autofixEvent(state, action.threadId, action.event);
  if (action.type === 'autofix-set') return autofixSet(state, action);
  if (action.type === 'auto-archive-set')
    return setPr(state, action.threadId, action.pr, {
      autoArchive: action.isOn || undefined,
    });
  if (action.type !== 'schedule-run') return state;
  const { event } = action;
  const thread = state.threads.find((t) => t.id === event.run.threadId);
  if (!thread) return state;
  const now = state.now;
  if (event.type === 'run-start') {
    return {
      ...state,
      threads: mapThread(state.threads, thread.id, (t) => {
        const woken = {
          ...t,
          status: 'running' as const,
          settledAt: undefined,
          settledMs: undefined,
          live: t.live && {
            ...t.live,
            isWorking: true,
            isDetached: undefined,
            limit: undefined,
          },
        };
        return log(
          log(woken, {
            at: now,
            who: 'harness',
            kind: 'event',
            text: `Scheduled run: ${event.run.reason}`,
          }),
          { at: now, who: 'you', kind: 'message', text: event.prompt },
        );
      }),
    };
  }
  const item: QueueItem = {
    id: `q-${event.run.id}`,
    kind: 'run',
    threadId: thread.id,
    title: runTitle(event.name, event.run),
    detail: runDetail(event.run),
    blocks: { steps: 0, threads: 0 },
    createdAt: now,
  };
  return {
    ...state,
    threads: mapThread(state.threads, thread.id, (t) =>
      log(t, {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `Scheduled run ended: ${item.title}`,
      }),
    ),
    queue: [...state.queue.filter((q) => q.id !== item.id), item],
  };
}

/** A watched thread's PR checks settled (main polls them): a pass is logged, a failure also lands in the Queue, once per failure. */
function ciResult(
  state: State,
  { threadId, result }: Extract<ScheduleEvent, { type: 'ci' }>,
): State {
  if (!state.threads.some((t) => t.id === threadId)) return state;
  const now = state.now;
  const title = ciTitle(result);
  const threads = mapThread(state.threads, threadId, (t) =>
    log(t, { at: now, who: 'harness', kind: 'event', text: title }),
  );
  if (result.status === 'pass') return { ...state, threads };
  const [check] = result.failed;
  const item: QueueItem = {
    // A newer failure replaces the card, so the minute it landed tells it from the last one.
    id: `q-ci-${threadId}-${result.pr}-${now}`,
    kind: 'ci',
    threadId,
    title,
    detail:
      result.failed.length > 1
        ? `Failed: ${result.failed.map((c) => c.name).join(', ')}`
        : '',
    ci: {
      pr: result.pr,
      url: result.url,
      check: check && { name: check.name, link: check.link },
    },
    blocks: { steps: 0, threads: 0 },
    createdAt: now,
  };
  // A newer failure on the same PR replaces the card instead of stacking.
  return {
    ...state,
    threads,
    queue: [
      ...state.queue.filter(
        (q) =>
          !(
            q.kind === 'ci' &&
            q.threadId === threadId &&
            q.ci?.pr === result.pr
          ),
      ),
      item,
    ],
  };
}

function setPr(
  state: State,
  threadId: string,
  pr: number,
  patch: Partial<PullRequest>,
): State {
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => ({
      ...t,
      prs: t.prs.map((p) => (p.number === pr ? { ...p, ...patch } : p)),
    })),
  };
}

/** Turning Auto-fix on tells the agent once, so it leaves CI to Mochi; off says nothing. */
function autofixSet(
  state: State,
  { threadId, pr, since }: Extract<Action, { type: 'autofix-set' }>,
): State {
  const thread = state.threads.find((t) => t.id === threadId);
  const found = thread?.prs.find((p) => p.number === pr);
  if (!thread || !found || !!found.autofixSince === !!since) return state;
  const set = {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => ({
      ...t,
      prs: t.prs.map((p) =>
        p.number === pr ? { ...p, autofixSince: since } : p,
      ),
    })),
  };
  if (!since)
    return {
      ...set,
      threads: mapThread(set.threads, threadId, (t) =>
        log(t, {
          at: state.now,
          who: 'you',
          kind: 'event',
          text: `Auto-fix off for #${pr}`,
        }),
      ),
    };
  const sent = autofixSend(set, threadId, {
    kind: 'enabled',
    pr,
    url: found.url,
  });
  return sent ? send(set, sent) : set;
}

/** An event from main, dropped when Auto-fix was turned off meanwhile; a parent thread hears of it only when `prEscalation` or `reportPrsEnded` says so. */
function autofixEvent(
  state: State,
  threadId: string,
  event: AutofixEvent,
): State {
  const thread = state.threads.find((t) => t.id === threadId);
  if (
    !thread ||
    thread.status === 'settled' ||
    !thread.prs.some((p) => p.number === event.pr && p.autofixSince)
  )
    return state;
  const escalation = prEscalation(thread, event);
  const next = autofixApply(state, thread, event);
  return reportPrsEnded(
    escalation ? reportPr(next, thread, event.pr, escalation) : next,
    thread,
  );
}

/** It goes to the agent like a message, unless main stopped it. */
function autofixApply(
  state: State,
  thread: Thread,
  event: AutofixEvent,
): State {
  const threadId = thread.id;
  if (event.kind !== 'stopped') {
    const sent = autofixSend(state, threadId, event);
    return sent ? send(state, sent) : state;
  }
  // Merged or closed is the PR's state too, which Auto-settle waits for.
  const ended = event.reason === 'cap' ? {} : { state: event.reason };
  const off = mapThread(state.threads, threadId, (t) =>
    log(
      {
        ...t,
        prs: t.prs.map((p) =>
          p.number === event.pr
            ? { ...p, ...ended, autofixSince: undefined }
            : p,
        ),
      },
      {
        at: state.now,
        who: 'harness',
        kind: 'event',
        text: autofixTitle(event),
      },
    ),
  );
  if (event.reason !== 'cap') return { ...state, threads: off };
  // Out of attempts: the failure lands in the Queue for you, as a watched thread's CI failure does.
  const failed = (event.failed ?? []).map((c) => ({
    name: c.name,
    state: 'fail' as const,
    link: c.link,
  }));
  return ciResult(
    { ...state, threads: off },
    {
      type: 'ci',
      threadId,
      result: { pr: event.pr, url: event.url, status: 'fail', failed },
    },
  );
}

/** The `send` an Auto-fix event becomes; none for a thread with no agent (the demo's). */
export function autofixSend(
  state: State,
  threadId: string,
  event: Exclude<AutofixEvent, { kind: 'stopped' }>,
): Extract<Action, { type: 'send' }> | null {
  if (!state.threads.find((t) => t.id === threadId)?.live) return null;
  return {
    type: 'send',
    threadId,
    text: autofixBody(event),
    prompt: autofixPrompt(event),
    reason: '',
    autofix: { kind: event.kind, pr: event.pr, title: autofixTitle(event) },
  };
}

export const runTitle = (name: string, run: ScheduleRun) =>
  `${name} ${runOutcome(run)}`;

/** "finished: 2 findings", "failed", … */
export function runOutcome(run: ScheduleRun) {
  if (run.status === 'running') return 'is running';
  if (run.status === 'done')
    return run.summary ? `finished: ${run.summary}` : 'finished';
  if (run.status === 'limited') return 'paused at the usage limit';
  if (run.status === 'interrupted') return 'was interrupted';
  if (run.status === 'skipped') return 'skipped';
  return 'failed';
}

function runDetail(run: ScheduleRun) {
  const ms = run.endedAt ? run.endedAt - run.startedAt : null;
  const took =
    ms === null
      ? null
      : ms < 60_000
        ? 'ran under a minute'
        : `ran ${duration(Math.round(ms / 60_000))}`;
  const parts = [
    run.reason,
    took,
    run.error,
    run.resetsAt &&
      `resumes after ${new Date(run.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  ];
  return parts.filter(Boolean).join(' · ');
}
