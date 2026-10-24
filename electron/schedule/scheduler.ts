import { v7 as uuidv7 } from 'uuid';
import { app } from 'electron';
import { Effect, Stream } from 'effect';
import { keyedStreams } from '@mochi/core/github/client';
import type { OpenPr } from '@mochi/core/github/schema';
import { mainCoreClient } from '@mochi/core/host';
import { readDoc, writeDoc } from '@mochi/core/store/client';
import type { AgentEvent } from '../../src/host/types/agent.ts';
import type { ScheduleEvent, ScheduleRun, Trigger, TriggerInput } from '../../src/host/types/schedule.ts';
import { describeCron } from '../../src/schedule/cron.ts';
import { afterLaunch, cronDecision, prEvents, prPrompt, summaryLine, SUMMARY_HINT, triggerAfter, withRun } from '../../src/schedule/due.ts';
import { isBusy, keepWhenClosed, onAgentEvent, openWindows, startAgent } from '../agents/events.ts';
import { mainWindow } from '../window.ts';

/**
 * Triggers live in main, so they fire while every window is closed (Mochi still running). Runs start the thread's agent
 * through the same `startAgent` the renderer uses, so the concurrency cap and the profile's account apply. While no main
 * window is open, run and agent events wait in `outbox` (saved) for the next window's `drain`.
 */
interface Saved {
  version: 1;
  triggers: Trigger[];
  outbox: ScheduleEvent[];
}

const TICK_MS = 30_000;
// PR triggers whose thread was busy when their PRs changed fire on this beat once it's idle.
const POLL_MS = 2 * 60_000;
// A day of quiet windows stays far under this; past it the oldest agent events go, run events are always kept.
const MAX_OUTBOX = 5_000;
const MAX_SEEN = 500;

let triggers: Trigger[] = [];
let outbox: ScheduleEvent[] = [];
/** PR trigger's thread id → the open PRs Core last reported for its `prWatch`, and which watch they came from. */
const openPrs = new Map<string, { key: string; prs: ReadonlyArray<OpenPr> }>();
/** Thread id → its trigger's run in flight, with the agent's latest message for the summary. */
const active = new Map<string, { run: ScheduleRun; name: string; message: string }>();

export async function startScheduler() {
  const saved = await readDoc<Saved>('schedule', 'schedules');
  const now = Date.now();
  // Runs that were going when Mochi quit stopped with it.
  triggers = (saved?.triggers ?? []).map((t) => afterLaunch({ ...t, runs: t.runs.map((r) => (r.status === 'running' ? { ...r, status: 'interrupted' as const, endedAt: now, error: 'Mochi quit during the run' } : r)) }, now));
  outbox = saved?.outbox ?? [];
  keepWhenClosed((event) => keep({ type: 'agent', event }));
  onAgentEvent(watch);
  changed();
  setInterval(tick, TICK_MS);
  setInterval(() => void poll(), POLL_MS);
}

export const scheduler = {
  list: () => triggers.map(strip),
  set(input: TriggerInput) {
    const now = Date.now();
    const old = triggers.find((t) => t.threadId === input.threadId);
    const isSameWhen = !!old && JSON.stringify(old.when) === JSON.stringify(input.when);
    const trigger: Trigger = {
      ...input,
      isPaused: old?.isPaused ?? false,
      createdAt: old?.createdAt ?? now,
      checkedAt: isSameWhen ? old.checkedAt : now,
      ...(isSameWhen && old.seen && { seen: old.seen }),
      sessionId: input.sessionId ?? old?.sessionId,
      runs: old?.runs ?? [],
    };
    triggers = [...triggers.filter((t) => t.threadId !== input.threadId), trigger];
    changed();
    if (input.when.kind === 'pr') void poll();
  },
  remove(threadId: string) {
    triggers = triggers.filter((t) => t.threadId !== threadId);
    changed();
  },
  setPaused(threadId: string, isPaused: boolean) {
    // Resuming doesn't make up for what came due while paused.
    update(threadId, (t) => ({ ...t, isPaused, ...(!isPaused && { checkedAt: Date.now() }) }));
  },
  async runNow(threadId: string) {
    const trigger = triggers.find((t) => t.threadId === threadId);
    if (!trigger) throw new Error('This thread has no schedule');
    if (active.has(threadId) || isBusy(threadId)) throw new Error('The thread is already working; it can run once this turn ends');
    await startRun(trigger, 'Run now', trigger.prompt);
  },
  drain() {
    const events = outbox;
    outbox = [];
    save();
    return events;
  },
};

function tick() {
  const now = Date.now();
  for (const trigger of triggers) {
    const decision = cronDecision(trigger, now, { isRunning: active.has(trigger.threadId), isBusy: isBusy(trigger.threadId) });
    if (decision.kind === 'idle' || decision.kind === 'wait') continue;
    update(trigger.threadId, (t) => ({ ...t, checkedAt: now }));
    if (decision.kind === 'skip') record(trigger, { id: runId(), threadId: trigger.threadId, reason: describe(trigger), startedAt: now, endedAt: now, status: 'skipped', error: `Skipped: ${decision.reason}` });
    else void startRun(trigger, decision.reason, trigger.prompt);
  }
}

type PrWatch = { threadId: string; cwd: string; isReviewRequested: boolean; githubUser?: string };

const prWatch = (t: Trigger): PrWatch | null =>
  t.when.kind === 'pr' && !t.isPaused && t.start.cwd ? { threadId: t.threadId, cwd: t.start.cwd, isReviewRequested: t.when.event === 'review-requested', githubUser: t.githubUser } : null;

// Core reads each repository once for every surface on it, fast after a push and backing off to every 10 minutes.
const prStreams = keyedStreams(
  ({ cwd, isReviewRequested, githubUser }: PrWatch) => Stream.unwrap(Effect.map(Effect.promise(mainCoreClient), (client) => client['github.openPrs']({ cwd, isReviewRequested, githubUser }))),
  (watch, prs) => {
    openPrs.set(watch.threadId, { key: JSON.stringify(watch), prs });
    void poll();
  },
  (watch, error) => console.warn(`PR watch for ${watch.threadId} failed: ${error instanceof Error ? error.message : String(error)}`),
);

/** Each PR trigger's latest open PRs against its baseline; a thread that is working waits, its events stay unseen until it's idle. */
async function poll() {
  for (const trigger of triggers) {
    const watch = prWatch(trigger);
    const latest = openPrs.get(trigger.threadId);
    // A list from the trigger's previous settings (another event or folder) would fire against the new baseline.
    if (!watch || latest?.key !== JSON.stringify(watch)) continue;
    if (active.has(trigger.threadId) || isBusy(trigger.threadId)) continue;
    const { fires, baseline } = prEvents(trigger, latest.prs.map((pr) => ({ ...pr, labels: [...pr.labels], statusCheckRollup: [...pr.statusCheckRollup] })));
    if (baseline) update(trigger.threadId, (t) => ({ ...t, seen: baseline }));
    const fire = fires[0];
    if (!fire) continue;
    update(trigger.threadId, (t) => ({ ...t, seen: [...(t.seen ?? []), fire.key].slice(-MAX_SEEN) }));
    await startRun(trigger, fire.reason, prPrompt(trigger.prompt, fire));
  }
}

async function startRun(trigger: Trigger, reason: string, prompt: string) {
  const run: ScheduleRun = { id: runId(), threadId: trigger.threadId, reason, startedAt: Date.now(), status: 'running' };
  active.set(trigger.threadId, { run, name: trigger.name, message: '' });
  record(trigger, run);
  deliver({ type: 'run-start', run, name: trigger.name, prompt });
  try {
    await startAgent(trigger.threadId, { ...trigger.start, prompt: `${prompt}\n\n${SUMMARY_HINT}`, ...(trigger.sessionId && { resume: trigger.sessionId }) });
  } catch (error) {
    finish(trigger.threadId, { status: 'failed', error: (error as Error).message });
  }
}

/** Keeps each trigger's session and branch current (`triggerAfter`) and ends runs on their turn's end. */
function watch(event: AgentEvent) {
  if ((event.type === 'session' || event.type === 'branch') && triggers.some((t) => t.threadId === event.threadId)) update(event.threadId, (t) => triggerAfter(t, event));
  const current = active.get(event.threadId);
  if (!current) return;
  if (event.type === 'message') current.message = event.isDelta ? current.message + event.text : event.text;
  if (event.type === 'limit') finish(event.threadId, { status: 'limited', resetsAt: event.resetsAt });
  if (event.type === 'turn-end') finish(event.threadId, { status: event.status, error: event.error });
}

function finish(threadId: string, outcome: Pick<ScheduleRun, 'status' | 'error' | 'resetsAt'>) {
  const current = active.get(threadId);
  if (!current) return;
  active.delete(threadId);
  const summary = summaryLine(current.message);
  const run: ScheduleRun = { ...current.run, ...outcome, endedAt: Date.now(), ...(summary && { summary }) };
  const trigger = triggers.find((t) => t.threadId === threadId);
  if (trigger) record(trigger, run);
  deliver({ type: 'run-end', run, name: current.name });
}

function record(trigger: Trigger, run: ScheduleRun) {
  update(trigger.threadId, (t) => ({ ...t, runs: withRun(t.runs, run) }));
}

function update(threadId: string, fn: (t: Trigger) => Trigger) {
  triggers = triggers.map((t) => (t.threadId === threadId ? fn(t) : t));
  changed();
}

export function deliver(event: ScheduleEvent) {
  if (!mainWindow()) return keep(event);
  for (const win of openWindows()) win.webContents.send('schedule:onEvent', event);
}

/** Agent text deltas fold into the previous kept event, so a long run keeps one message per turn. */
function keep(event: ScheduleEvent) {
  const last = outbox.at(-1);
  if (event.type === 'agent' && event.event.type === 'message' && event.event.isDelta && last?.type === 'agent' && last.event.type === 'message' && last.event.threadId === event.event.threadId) {
    outbox = [...outbox.slice(0, -1), { type: 'agent', event: { ...last.event, text: last.event.text + event.event.text } }];
  } else {
    outbox = [...outbox, event];
  }
  if (outbox.length > MAX_OUTBOX) {
    const drop = outbox.findIndex((e) => e.type === 'agent');
    if (drop >= 0) outbox.splice(drop, 1);
  }
  save();
}

function changed() {
  save();
  prStreams(triggers.flatMap((t) => prWatch(t) ?? []));
  const list = triggers.map(strip);
  for (const win of openWindows()) win.webContents.send('schedule:onChange', list);
}

const strip = (t: Trigger): Trigger => ({ ...t, seen: undefined });
const runId = () => `run-${uuidv7()}`;
const describe = (t: Trigger) => (t.when.kind === 'cron' ? describeCron(t.when.cron) : `PR ${t.when.event}`);

let timer: ReturnType<typeof setTimeout> | undefined;

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}

function flush() {
  timer = undefined;
  // writeDoc logs a failure; the next change writes the whole document again.
  void writeDoc('schedule', 'schedules', { version: 1, triggers, outbox } satisfies Saved).catch(() => {});
}

// A save still waiting on its timer goes now; quitting waits for Core to have it (`startCore`).
app.on('before-quit', () => {
  if (!timer) return;
  clearTimeout(timer);
  flush();
});
