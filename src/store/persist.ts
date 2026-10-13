import { pauseQueue } from '../chat/outbox.ts';
import { LIMIT_DEMO_IDS } from '../usage/limitDemo.ts';
import { host } from '../host/index.ts';
import type { WorktreeSetup } from '../host/types/agent.ts';
import type { QueueItem, Thread } from '../model.ts';
import type { Checkpoint } from '../rewind/checkpoints.ts';
import type { Fork } from '../rewind/fork.ts';
import type { State } from './index.tsx';

/** What the desktop app saves between launches: your own (live) threads and the slices that refer to them. Demo threads start fresh every launch. */
export interface Saved {
  version: 1;
  now: number;
  seq: number;
  threads: Thread[];
  queue: QueueItem[];
  checkpoints: Record<string, Checkpoint[]>;
  checkpointSeq: number;
  forks: Record<string, Fork>;
}

export function toSaved(state: State): Saved {
  const threads = state.threads.filter((t) => t.live && !LIMIT_DEMO_IDS.includes(t.id));
  const ids = new Set(threads.map((t) => t.id));
  const pick = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
  return {
    version: 1,
    now: state.now,
    seq: state.seq,
    threads,
    queue: state.queue.filter((q) => ids.has(q.threadId)),
    checkpoints: pick(state.checkpoints),
    checkpointSeq: state.checkpointSeq,
    forks: pick(state.forks),
  };
}

/** A save as it comes back on launch: every agent stopped when Mochi quit, so threads are idle and detached, and approvals or questions they were waiting on are gone. */
export function parseSaved(json: string | null): Saved | null {
  if (!json) return null;
  try {
    const saved = JSON.parse(json) as Saved;
    if (saved?.version !== 1 || !Array.isArray(saved.threads) || !Array.isArray(saved.queue)) return null;
    const threads = saved.threads.filter((t) => typeof t?.id === 'string' && t.live).map((t) => restoreThread(t, saved.now));
    // Agent requests and Mochi tool cards wait on a live call, which a restart ended.
    return { ...saved, threads, queue: saved.queue.filter((q) => !q.requestId && !q.tool) };
  } catch {
    return null;
  }
}

function restoreThread(thread: Thread, now: number): Thread {
  const live = { ...thread.live!, isWorking: false, isDetached: true, starting: undefined };
  const reviews = thread.reviews?.map((r) => (r.status === 'running' ? { ...r, status: 'failed' as const, error: 'Stopped when Mochi quit' } : r));
  const subagents = thread.subagents?.map((s) => (s.status === 'running' ? { ...s, status: 'stopped' as const, error: 'Stopped when Mochi quit', activity: undefined } : s));
  const setup = thread.setup && (thread.setup.status === 'running' || thread.setup.status === 'failed') ? stoppedSetup(thread.setup) : thread.setup;
  // Sending the queue on launch would spend usage unasked.
  const restored = pauseQueue({ ...thread, live, ...(reviews && { reviews }), ...(subagents && { subagents }), ...(setup && { setup }), ...(thread.setup?.status === 'failed' && thread.status === 'needs-you' && { status: 'running' as const }) }, 'restart');
  if (!thread.live!.isWorking) return restored;
  return { ...restored, activity: [...thread.activity, { at: now, who: 'harness', kind: 'event', text: 'Stopped when Mochi quit. Send a message to continue.' }] };
}

/** A setup Mochi quit during: the next message starts the agent in the worktree as it is. */
function stoppedSetup(setup: WorktreeSetup): WorktreeSetup {
  return { ...setup, status: 'cancelled', steps: setup.steps.map((s) => (s.status === 'running' || s.status === 'pending' ? { ...s, status: 'skipped' } : s)) };
}

let restored: Saved | null = null;
let isSaveBlocked = false;

/** Called once with the saved file before the store is created (`src/main.tsx`). */
export function restoreSaved(json: string | null) {
  restored = parseSaved(json);
  if (json && !restored) restoreFailed(new Error('threads.json is not a save this version can read'));
}

/** Saving stays off for this run, so a file that failed to load is never overwritten with an empty list. */
export function restoreFailed(error: unknown) {
  isSaveBlocked = true;
  console.error('Loading saved threads failed; saving is off until the next launch', error);
}

export function getRestored() {
  return restored;
}

const SAVE_DELAY_MS = 500;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: State | null = null;
let last = '';

/** Debounced; a no-op in the web build. Flushed when the window unloads, so quitting right after a message keeps it. */
export function saveThreads(state: State) {
  if (!host.isDesktop || isSaveBlocked) return;
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY_MS);
}

function flush() {
  clearTimeout(timer);
  if (!pending) return;
  const json = JSON.stringify(toSaved(pending));
  pending = null;
  if (json === last) return;
  last = json;
  host.data.save(json).catch((error: unknown) => console.error('Saving threads failed', error));
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush);
