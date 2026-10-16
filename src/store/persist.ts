import { pauseQueue } from '../chat/outbox.ts';
import { migrateReceived } from '../chat/threadMessages.ts';
import { LIMIT_DEMO_IDS } from '../usage/limitDemo.ts';
import { host } from '../host/index.ts';
import type { AttachedAgent, WorktreeSetup } from '../host/types/agent.ts';
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

/** Each thread whose agent outlived the window (a reload, not a quit), and whether it's mid-turn. */
export type Attached = Map<string, boolean>;

/**
 * A save as it comes back on launch: every agent stopped when Mochi quit, so threads are idle and detached, and approvals or questions
 * they were waiting on are gone. After a window reload the agents in `attached` are still running in main and stay attached.
 */
export function parseSaved(json: string | null, attached: Attached = new Map()): Saved | null {
  const saved = readSaved(json);
  return saved && restoreSavedThreads(saved, attached);
}

function readSaved(json: string | null): Saved | null {
  if (!json) return null;
  try {
    const saved = JSON.parse(json) as Saved;
    if (saved?.version !== 1 || !Array.isArray(saved.threads) || !Array.isArray(saved.queue)) return null;
    return { ...saved, threads: saved.threads.filter((t) => typeof t?.id === 'string' && t.live) };
  } catch {
    return null;
  }
}

function restoreSavedThreads(saved: Saved, attached: Attached): Saved {
  // A Mochi tool card waits on the old page's run of the call; after a reload the new page runs it again and asks anew.
  const reasked = new Set(saved.queue.filter((q) => q.tool && attached.has(q.threadId)).map((q) => q.id));
  // A save from before read state reads as all seen, not as every thread unread at once.
  const threads = migrateReceived(saved.threads.map((t) => (attached.has(t.id) ? reattachThread(t, attached.get(t.id)!, reasked) : restoreThread(t, saved.now)))).map((t) => ({ ...t, seenActivity: t.seenActivity ?? t.activity.length }));
  // Agent requests wait on a live call, which a restart ended; a reload didn't, so an attached agent's still wait on you.
  return { ...saved, threads, queue: saved.queue.filter((q) => (!q.requestId || attached.has(q.threadId)) && !q.tool) };
}

function reattachThread(thread: Thread, isWorking: boolean, reasked: Set<string>): Thread {
  const activity = thread.activity.filter((e) => !(e.card?.isOpen && reasked.has(e.card.id)));
  return { ...thread, activity, live: { ...thread.live!, isWorking, isDetached: false } };
}

function restoreThread(thread: Thread, now: number): Thread {
  const live = { ...thread.live!, isWorking: false, isDetached: true, starting: undefined };
  const reviews = thread.reviews?.map((r) => (r.status === 'running' ? { ...r, status: 'failed' as const, error: 'Stopped when Mochi quit' } : r));
  const subagents = thread.subagents?.map((s) => (s.status === 'running' ? { ...s, status: 'stopped' as const, error: 'Stopped when Mochi quit', activity: undefined } : s));
  // A check or audit Mochi quit during never finishes: the verdict would read Checking for good.
  const criteria = thread.criteria?.map((c) => (c.check?.status === 'running' ? { ...c, check: undefined } : c));
  const idle = thread.idle && { ...thread.idle, isGathering: undefined };
  const setup = thread.setup && (thread.setup.status === 'running' || thread.setup.status === 'failed') ? stoppedSetup(thread.setup) : thread.setup;
  // Sending the queue on launch would spend usage unasked.
  const restored = pauseQueue({ ...thread, live, ...(criteria && { criteria }), ...(idle && { idle }), ...(reviews && { reviews }), ...(subagents && { subagents }), ...(setup && { setup }), ...(thread.setup?.status === 'failed' && thread.status === 'needs-you' && { status: 'running' as const }) }, 'restart');
  // An image still being made when Mochi quit never lands; its card says so instead of generating forever.
  const activity = restored.activity.map((e) => (e.generated?.status === 'running' ? { ...e, generated: { ...e.generated, status: 'failed' as const, error: 'Stopped when Mochi quit' } } : e));
  if (!thread.live!.isWorking) return { ...restored, activity };
  return { ...restored, activity: [...activity, { at: now, who: 'harness', kind: 'event', text: 'Stopped when Mochi quit. Send a message to continue.' }] };
}

/** A setup Mochi quit during: the next message starts the agent in the worktree as it is. */
function stoppedSetup(setup: WorktreeSetup): WorktreeSetup {
  return { ...setup, status: 'cancelled', steps: setup.steps.map((s) => (s.status === 'running' || s.status === 'pending' ? { ...s, status: 'skipped' } : s)) };
}

let restored: Saved | null = null;
let isSaveBlocked = false;

/** Called once with the saved file before the store is created (`src/main.tsx`). */
export async function restoreSaved(json: string | null) {
  const saved = readSaved(json);
  if (json && !saved) return restoreFailed(new Error('threads.json is not a save this version can read'));
  if (!saved) return;
  // The events they sent meanwhile are replayed once the store mounts (`src/store/index.tsx`).
  const live = await host.agent.attached(saved.threads.map((t) => ({ threadId: t.id }))).catch((): AttachedAgent[] => []);
  restored = restoreSavedThreads(saved, new Map(live.map((a) => [a.threadId, a.isWorking])));
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
