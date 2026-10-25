import type { ActivityEntry, Provider, Thread } from '../model.ts';
import { log } from '../store/threads.ts';

// Mochi relays what each harness does at a usage limit and adds nothing of its own (RUNTIME.md › Usage limits).

/**
 * The limit hit. Claude Code keeps the turn and continues it at the reset (`isTurnHeld`): the thread stays working. Codex ends
 * the turn: the thread waits for you, its queue holds. The entry logged here becomes the live limit card.
 */
export function hitLimit(
  thread: Thread,
  event: { resetsAt?: string; label?: string; isTurnHeld?: boolean },
  now: number,
): Thread {
  if (!thread.live) return thread;
  const window = event.label;
  const entry: ActivityEntry = {
    at: now,
    who: 'harness',
    kind: 'event',
    isLimit: true,
    text: `${PROVIDER_NAMES[thread.providers[0]]} hit the ${window ? `${window.toLowerCase()} ` : ''}usage limit`,
  };
  const limit = {
    ...(event.resetsAt && { resetsAt: event.resetsAt }),
    ...(window && { label: window }),
    ...(event.isTurnHeld && { isTurnHeld: true }),
  };
  if (event.isTurnHeld)
    return log({ ...thread, live: { ...thread.live, limit } }, entry);
  return log(
    {
      ...thread,
      ...(thread.queued?.length && { queuePause: 'limit' as const }),
      status: 'needs-you',
      live: { ...thread.live, isWorking: false, limit },
    },
    entry,
  );
}

/** Claude Code got past the limit on its own: the window reopened and the held turn goes on. */
export function clearLimit(thread: Thread, now: number): Thread {
  if (!thread.live?.limit) return thread;
  return log(
    { ...thread, live: { ...thread.live, limit: undefined } },
    {
      at: now,
      who: 'harness',
      kind: 'event',
      text: 'The limit reset; the turn continues',
    },
  );
}

/** Codex's failed turn after its limit is the limit itself, already said by its card. */
export const isLimitEnd = (thread: Thread) =>
  !!thread.live?.limit && !thread.live.limit.isTurnHeld;

/** Codex threads you set to Resume at reset whose reset has passed. */
export function dueResumes(threads: Thread[], nowMs = Date.now()) {
  return threads.filter(
    (t) =>
      t.live?.limit?.autoResume &&
      (!t.live.limit.resetsAt || Date.parse(t.live.limit.resetsAt) <= nowMs),
  );
}

/** The earliest armed reset still ahead, so one timer covers every thread. */
export function nextResumeAt(threads: Thread[], nowMs = Date.now()) {
  const times = threads
    .flatMap((t) =>
      t.live?.limit?.autoResume && t.live.limit.resetsAt
        ? [Date.parse(t.live.limit.resetsAt)]
        : [],
    )
    .filter((at) => at > nowMs);
  return times.length ? Math.min(...times) : undefined;
}

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<
  Provider,
  string
>;
