import { pauseQueue } from '../chat/outbox.ts';
import { migrateReceived } from '../chat/threadMessages.ts';
import { LIMIT_DEMO_IDS } from '../usage/limitDemo.ts';
import { host } from '../host/index.ts';
import type { AttachedAgent, WorktreeSetup } from '../host/types/agent.ts';
import type { SavedFiles } from '../host/types/data.ts';
import type { QueueItem, Thread } from '../model.ts';
import type { Checkpoint } from '../rewind/checkpoints.ts';
import type { Fork } from '../rewind/fork.ts';
import { failDrafts } from '../rewind/handoff.ts';
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

/** On disk the save is split so each write touches only the threads that changed (`electron/ipc/threadStore.ts`). */
interface SavedIndex extends Omit<Saved, 'threads' | 'checkpoints' | 'forks'> {
  threadIds: string[];
}

interface SavedThread {
  thread: Thread;
  checkpoints?: Checkpoint[];
  fork?: Fork;
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
  const saved = json ? readSaved(() => JSON.parse(json) as Saved) : null;
  return saved && restoreSavedThreads(saved, attached);
}

function readSaved(parse: () => Saved): Saved | null {
  try {
    const saved = parse();
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
  const threads = migrateReceived(saved.threads.map((t) => (attached.has(t.id) ? reattachThread(t, attached.get(t.id)!, reasked) : restoreThread(t, saved.now))))
    .map(migrateWaitingSteps)
    .map((t) => ({ ...t, seenActivity: t.seenActivity ?? t.activity.length }));
  // Agent requests wait on a live call, which a restart ended; a reload didn't, so an attached agent's still wait on you.
  // Overlap cards saved before that feature was removed have nothing left to answer them.
  return { ...saved, threads, queue: saved.queue.filter((q) => (!q.requestId || attached.has(q.threadId)) && !q.tool && (q.kind as string) !== 'overlap') };
}

/** A step an overlap held was saved `waiting`, a status that went with overlaps; it's up next again. */
function migrateWaitingSteps(thread: Thread): Thread {
  if (!thread.steps.some((s) => (s.status as string) === 'waiting')) return thread;
  return { ...thread, steps: thread.steps.map((s) => ((s.status as string) === 'waiting' ? { ...s, status: 'ready' } : s)) };
}

function reattachThread(thread: Thread, isWorking: boolean, reasked: Set<string>): Thread {
  // The draft ran in the window that reloaded; its answer never comes.
  const activity = failDrafts(
    thread.activity.filter((e) => !(e.card?.isOpen && reasked.has(e.card.id))),
    'Stopped when the window reloaded',
  );
  return { ...thread, activity, live: { ...thread.live!, isWorking, isDetached: false } };
}

function restoreThread(thread: Thread, now: number): Thread {
  const live = { ...thread.live!, isWorking: false, isDetached: true, starting: undefined };
  const reviews = thread.reviews?.map((r) => (r.status === 'running' ? { ...r, status: 'failed' as const, error: 'Stopped when Mochi quit' } : r));
  const subagents = thread.subagents?.map((s) => (s.status === 'running' ? { ...s, status: 'stopped' as const, error: 'Stopped when Mochi quit', activity: undefined } : s));
  const backgroundTasks = thread.backgroundTasks?.map((t) => (t.status === 'running' ? { ...t, status: 'stopped' as const } : t));
  // A check or audit Mochi quit during never finishes: the verdict would read Checking for good.
  const criteria = thread.criteria?.map((c) => (c.check?.status === 'running' ? { ...c, check: undefined } : c));
  const idle = thread.idle && { ...thread.idle, isGathering: undefined };
  const setup = thread.setup && (thread.setup.status === 'running' || thread.setup.status === 'failed') ? stoppedSetup(thread.setup) : thread.setup;
  // Sending the queue on launch would spend usage unasked.
  // A steer the agent never read went down with its process: it waits in the queue instead.
  const queued = thread.steering ? [...thread.steering.map((s) => s.message), ...(thread.queued ?? [])] : thread.queued;
  const restored = pauseQueue({ ...thread, live, queued, steering: undefined, ...(criteria && { criteria }), ...(idle && { idle }), ...(reviews && { reviews }), ...(subagents && { subagents }), ...(backgroundTasks && { backgroundTasks }), ...(setup && { setup }), ...(thread.setup?.status === 'failed' && thread.status === 'needs-you' && { status: 'running' as const }) }, 'restart');
  // An image still being made when Mochi quit never lands; its card says so instead of generating forever.
  const activity = failDrafts(
    restored.activity.map((e) => (e.generated?.status === 'running' ? { ...e, generated: { ...e.generated, status: 'failed' as const, error: 'Stopped when Mochi quit' } } : e)),
    'Stopped when Mochi quit',
  );
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
export async function restoreSaved(files: SavedFiles | null) {
  const saved = files && readSaved(() => joinSaved(files));
  if (files && !saved) return restoreFailed(new Error('The saved threads are not a save this version can read'));
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
let lastIndex = '';
/** Each thread's file as the last save that landed wrote it. */
const written = new Map<string, string>();

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
  const { index, threads } = splitSaved(toSaved(pending));
  pending = null;
  const changed = Object.fromEntries(Object.entries(threads).filter(([id, json]) => written.get(id) !== json));
  if (index === lastIndex && !Object.keys(changed).length) return;
  lastIndex = index;
  host.data.save(index, changed).then(
    () => {
      for (const [id, json] of Object.entries(changed)) written.set(id, json);
      for (const id of written.keys()) if (!(id in threads)) written.delete(id);
    },
    (error: unknown) => {
      lastIndex = '';
      console.error('Saving threads failed', error);
    },
  );
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush);

export function splitSaved({ threads, checkpoints, forks, ...rest }: Saved) {
  const index = JSON.stringify({ ...rest, threadIds: threads.map((t) => t.id) } satisfies SavedIndex);
  return { index, threads: Object.fromEntries(threads.map((t) => [t.id, encodeThread(t, checkpoints[t.id], forks[t.id])])) };
}

/** A `threads.json` from before the split comes back as the index, its threads still inside it. */
export function joinSaved({ index, threads }: SavedFiles): Saved {
  const head = JSON.parse(index) as Partial<Saved>;
  const parts = threads.flatMap((text): SavedThread[] => {
    try {
      return [JSON.parse(text) as SavedThread];
    } catch {
      // A thread file is written whole or not at all; one that still won't parse costs that thread, not the others.
      return [];
    }
  });
  return {
    ...(head as Saved),
    threads: [...(head.threads ?? []), ...parts.map((p) => p.thread)],
    checkpoints: { ...head.checkpoints, ...Object.fromEntries(parts.flatMap((p) => (p.checkpoints ? [[p.thread.id, p.checkpoints]] : []))) },
    forks: { ...head.forks, ...Object.fromEntries(parts.flatMap((p) => (p.fork ? [[p.thread.id, p.fork]] : []))) },
  };
}

// Reducers replace a thread only when it changes, so an unchanged thread skips JSON.stringify and compares as the same string.
const encoded = new WeakMap<Thread, SavedThread & { json: string }>();

function encodeThread(thread: Thread, checkpoints: Checkpoint[] | undefined, fork: Fork | undefined): string {
  const hit = encoded.get(thread);
  if (hit && hit.checkpoints === checkpoints && hit.fork === fork) return hit.json;
  const json = JSON.stringify({ thread, checkpoints, fork } satisfies SavedThread);
  encoded.set(thread, { thread, checkpoints, fork, json });
  return json;
}
