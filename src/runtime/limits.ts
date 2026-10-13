import type { LimitWindow } from '../host/types/agent.ts';
import type { ActivityEntry, Provider, Thread } from '../model.ts';
import { log } from '../store/threads.ts';

// Usage limit states (RUNTIME.md › Usage limits): approaching → wrapping up → paused until reset → resumed.

/** At this share of a window the turn in flight is asked to wrap up: Claude Code's own checkpoint threshold (`pS`, 2.1.296). */
export const WRAP_PCT = 95;

/** Mochi's own wrap-up for Codex, which has none; Claude Code injects its own hint at `WRAP_PCT`. */
export const WRAP_PROMPT =
  "Mochi: this account is about to hit its usage limit. Finish the step you're on, then stop and write a short checkpoint: what's done, and up to 3 bullets of what's left. Don't start long-running work or subagents.";

export type LimitPhase = 'approaching' | 'wrapping-up' | 'paused';

/** Where a live thread stands against its account's plan limits; undefined while nothing is close. */
export function limitPhase(thread: Thread): LimitPhase | undefined {
  const live = thread.live;
  if (live?.limit) return 'paused';
  if (live?.isWrappingUp) return 'wrapping-up';
  if (live?.limitWarning) return 'approaching';
}

/** Logs each window's warning once; past `WRAP_PCT` in a turn, asks for a wrap-up (sent by `agentCalls`, Codex only). */
export function warnLimit(thread: Thread, window: LimitWindow, now: number, who: Provider): Thread {
  const live = thread.live;
  if (!live || live.limit) return thread;
  const known = live.limitWarning;
  const isNew = known?.id !== window.id;
  const shouldWrap = live.isWorking && !live.isWrappingUp && window.usedPct >= WRAP_PCT;
  let next: Thread = { ...thread, live: { ...live, limitWarning: window, ...(shouldWrap && { isWrappingUp: true }) } };
  const name = PROVIDER_NAMES[who];
  if (isNew) next = log(next, { at: now, who: 'harness', kind: 'event', text: `${name}'s ${window.label.toLowerCase()} limit is ${Math.round(window.usedPct)}% used`, detail: 'Turns still run; Mochi pauses the thread when the limit hits.' });
  if (shouldWrap) next = log(next, { at: now, who: 'harness', kind: 'event', text: `Wrapping up before the ${window.label.toLowerCase()} limit`, detail: who === 'claude' ? 'Claude Code checkpoints the current step on its own.' : 'Mochi asked Codex to finish this step and leave a checkpoint.' });
  return next;
}

/** The limit hit: the thread stops until you resume, its queue holds, and the entry logged here becomes the live limit card. */
export function hitLimit(thread: Thread, event: { resetsAt?: string; label?: string }, now: number): Thread {
  if (!thread.live) return thread;
  const window = event.label ?? thread.live.limitWarning?.label;
  const entry: ActivityEntry = { at: now, who: 'harness', kind: 'event', isLimit: true, text: `${PROVIDER_NAMES[thread.providers[0]]} hit the ${window ? `${window.toLowerCase()} ` : ''}usage limit` };
  const live = { ...thread.live, isWorking: false, isWrappingUp: undefined, limitWarning: undefined, limit: { ...(event.resetsAt && { resetsAt: event.resetsAt }), ...(window && { label: window }) } };
  // A message you add while paused waits for the resume too (`heldBy`).
  return log({ ...thread, ...(thread.queued?.length && { queuePause: 'limit' as const }), status: 'needs-you', live }, entry);
}

/** A turn's end after the limit hit is the limit's own failure, already said by its card. */
export const isLimitEnd = (thread: Thread) => !!thread.live?.limit;

/**
 * Why a message to `thread` must wait instead of starting a turn: its own pause, or another thread on the same profile and
 * harness (the same account) paused until a reset still ahead. Nothing starts on that account before the reset.
 */
export function heldBy(threads: Thread[], thread: Thread, nowMs = Date.now()): AccountHold | undefined {
  if (thread.live?.isOnApiKey) return;
  if (thread.live?.limit) return { ...thread.live.limit, threadId: thread.id };
  return accountHold(threads.filter((t) => t.id !== thread.id), thread.spaceId, thread.providers[0], nowMs);
}

export type AccountHold = { resetsAt?: string; label?: string; threadId: string };

/** A thread on this profile's `provider` account paused until a reset still ahead; a new thread there waits for it too. */
export function accountHold(threads: Thread[], spaceId: string, provider: Provider, nowMs = Date.now()): AccountHold | undefined {
  // Only a real session's pause speaks for the account: the demo thread's has none.
  const other = threads.find((t) => !!t.session && t.spaceId === spaceId && t.providers[0] === provider && !t.live?.isOnApiKey && !!t.live?.limit?.resetsAt && Date.parse(t.live.limit.resetsAt) > nowMs);
  return other?.live?.limit && { ...other.live.limit, threadId: other.id };
}

/** Threads armed to resume at their reset whose reset has passed. */
export function dueResumes(threads: Thread[], nowMs = Date.now()) {
  return threads.filter((t) => t.live?.limit?.autoResume && (!t.live.limit.resetsAt || Date.parse(t.live.limit.resetsAt) <= nowMs));
}

/** The earliest armed reset still ahead, so one timer covers every thread. */
export function nextResumeAt(threads: Thread[], nowMs = Date.now()) {
  const times = threads.flatMap((t) => (t.live?.limit?.autoResume && t.live.limit.resetsAt ? [Date.parse(t.live.limit.resetsAt)] : [])).filter((at) => at > nowMs);
  return times.length ? Math.min(...times) : undefined;
}

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;
