import { pauseQueue } from '../chat/queued.ts';
import { migrateReceived } from '../chat/threadMessages.ts';
import { LIMIT_DEMO_IDS } from '../usage/limitDemo.ts';
import { Schema } from 'effect';
import { Persist } from '@mochi/schema';
import type { WorktreeSetup } from '../host/types/agent.ts';
import type { SavedFiles } from '../host/types/data.ts';
import type { QueueItem, Thread } from '../model.ts';
import type { Checkpoint } from '../rewind/checkpoints.ts';
import type { Fork } from '../rewind/fork.ts';
import { failDrafts } from '../rewind/handoff.ts';
import type { State } from './types.ts';

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

/** The save is split so each write touches only the threads that changed: one row per thread in Core's store (`packages/core/src/store/store.ts`). */
interface SavedIndex extends Omit<Saved, 'threads' | 'checkpoints' | 'forks'> {
  threadIds: string[];
}

export interface SavedThread {
  thread: Thread;
  checkpoints?: Checkpoint[];
  fork?: Fork;
}

export function toSaved(
  state: Pick<
    State,
    | 'now'
    | 'seq'
    | 'threads'
    | 'queue'
    | 'checkpoints'
    | 'checkpointSeq'
    | 'forks'
  >,
): Saved {
  const threads = state.threads.filter(
    (t) => t.live && !LIMIT_DEMO_IDS.includes(t.id),
  );
  const ids = new Set(threads.map((t) => t.id));
  const pick = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
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
export function parseSaved(
  json: string | null,
  attached: Attached = new Map(),
): Saved | null {
  const saved = json ? decodeSaved(json) : null;
  return saved && restoreSavedThreads(saved, attached);
}

const decodeWhole = Schema.decodeUnknownOption(
  Schema.fromJsonString(Persist.Saved),
);
const decodeValue = Schema.decodeUnknownOption(Persist.Saved);
const decodeThreadValue = Schema.decodeUnknownOption(Persist.SavedThread);

/** A save this version can read, its legacy shapes upgraded (`Persist.Saved`); null for anything else. */
function decodeSaved(json: string): Saved | null {
  const decoded = decodeWhole(json);
  return decoded._tag === 'Some' ? fromDecoded(decoded.value) : null;
}

/** `decodeSaved` for a value already parsed: a `replica` snapshot. */
export function savedFrom(value: unknown): Saved | null {
  const decoded = decodeValue(value);
  return decoded._tag === 'Some' ? fromDecoded(decoded.value) : null;
}

/** One thread's file as another computer streams it (`Persist.SavedThread`); null for anything else. */
export function savedThreadFrom(value: unknown): SavedThread | null {
  const decoded = decodeThreadValue(value);
  // Decoded values are the model's types, readonly (as `fromDecoded`).
  return decoded._tag === 'Some'
    ? (decoded.value as unknown as SavedThread)
    : null;
}

/** Only live threads are saved; demo threads start fresh every launch. */
function fromDecoded(decoded: Persist.Saved): Saved {
  // Decoded values are the model's types (src/schemaConformance/persist.ts checks it), readonly; the store's slices aren't.
  const { now, seq, threads, queue, checkpoints, checkpointSeq, forks } =
    decoded as unknown as Saved;
  return {
    version: 1,
    now,
    seq,
    threads: threads.filter((t) => t.live),
    queue,
    checkpoints,
    checkpointSeq,
    forks,
  };
}

export function restoreSavedThreads(
  saved: Saved,
  attached: Attached = new Map(),
): Saved {
  // A Mochi tool card waits on the old page's run of the call; after a reload the new page runs it again and asks anew.
  const reasked = new Set(
    saved.queue
      .filter((q) => q.tool && attached.has(q.threadId))
      .map((q) => q.id),
  );
  // A save from before read state reads as all seen, not as every thread unread at once.
  const threads = migrateReceived(
    saved.threads.map((t) =>
      attached.has(t.id)
        ? reattachThread(t, attached.get(t.id)!, reasked)
        : restoreThread(t, saved.now),
    ),
  )
    .map(migrateWaitingSteps)
    .map((t) => ({ ...t, seenActivity: t.seenActivity ?? t.activity.length }));
  // Agent requests wait on a live call, which a restart ended; a reload didn't, so an attached agent's still wait on you.
  // Overlap cards saved before that feature was removed have nothing left to answer them.
  return {
    ...saved,
    threads,
    queue: saved.queue.filter(
      (q) =>
        (!q.requestId || attached.has(q.threadId)) &&
        !q.tool &&
        (q.kind as string) !== 'overlap',
    ),
  };
}

/** A step an overlap held was saved `waiting`, a status that went with overlaps; it's up next again. */
function migrateWaitingSteps(thread: Thread): Thread {
  if (!thread.steps.some((s) => (s.status as string) === 'waiting'))
    return thread;
  return {
    ...thread,
    steps: thread.steps.map((s) =>
      (s.status as string) === 'waiting' ? { ...s, status: 'ready' } : s,
    ),
  };
}

function reattachThread(
  thread: Thread,
  isWorking: boolean,
  reasked: Set<string>,
): Thread {
  // The draft ran in the window that reloaded; its answer never comes.
  const activity = failDrafts(
    thread.activity.filter((e) => !(e.card?.isOpen && reasked.has(e.card.id))),
    'Stopped when the window reloaded',
  );
  return {
    ...thread,
    activity,
    live: { ...thread.live!, isWorking, isDetached: false },
  };
}

function restoreThread(thread: Thread, now: number): Thread {
  const live = {
    ...thread.live!,
    isWorking: false,
    isDetached: true,
    starting: undefined,
  };
  const reviews = thread.reviews?.map((r) =>
    r.status === 'running'
      ? { ...r, status: 'failed' as const, error: 'Stopped when Mochi quit' }
      : r,
  );
  const subagents = thread.subagents?.map((s) =>
    s.status === 'running'
      ? {
          ...s,
          status: 'stopped' as const,
          error: 'Stopped when Mochi quit',
          activity: undefined,
        }
      : s,
  );
  const backgroundTasks = thread.backgroundTasks?.map((t) =>
    t.status === 'running' ? { ...t, status: 'stopped' as const } : t,
  );
  // A check or audit Mochi quit during never finishes: the verdict would read Checking for good.
  const criteria = thread.criteria?.map((c) =>
    c.check?.status === 'running' ? { ...c, check: undefined } : c,
  );
  const idle = thread.idle && { ...thread.idle, isGathering: undefined };
  const setup =
    thread.setup &&
    (thread.setup.status === 'running' || thread.setup.status === 'failed')
      ? stoppedSetup(thread.setup)
      : thread.setup;
  // Sending the queue on launch would spend usage unasked.
  // A steer the agent never read went down with its process: it waits in the queue instead.
  const queued = thread.steering
    ? [...thread.steering.map((s) => s.message), ...(thread.queued ?? [])]
    : thread.queued;
  const restored = pauseQueue(
    {
      ...thread,
      live,
      queued,
      steering: undefined,
      isInterruptedToSend: undefined,
      ...(criteria && { criteria }),
      ...(idle && { idle }),
      ...(reviews && { reviews }),
      ...(subagents && { subagents }),
      ...(backgroundTasks && { backgroundTasks }),
      ...(setup && { setup }),
      ...(thread.setup?.status === 'failed' &&
        thread.status === 'needs-you' && { status: 'running' as const }),
    },
    'restart',
  );
  // An image still being made when Mochi quit never lands; its card says so instead of generating forever.
  const activity = failDrafts(
    restored.activity.map((e) =>
      e.generated?.status === 'running'
        ? {
            ...e,
            generated: {
              ...e.generated,
              status: 'failed' as const,
              error: 'Stopped when Mochi quit',
            },
          }
        : e,
    ),
    'Stopped when Mochi quit',
  );
  if (!thread.live!.isWorking) return { ...restored, activity };
  return {
    ...restored,
    activity: [
      ...activity,
      {
        at: now,
        who: 'harness',
        kind: 'event',
        text: 'Stopped when Mochi quit. Send a message to continue.',
      },
    ],
  };
}

/** A setup Mochi quit during: the next message starts the agent in the worktree as it is. */
function stoppedSetup(setup: WorktreeSetup): WorktreeSetup {
  return {
    ...setup,
    status: 'cancelled',
    steps: setup.steps.map((s) =>
      s.status === 'running' || s.status === 'pending'
        ? { ...s, status: 'skipped' }
        : s,
    ),
  };
}

export function splitSaved({ threads, checkpoints, forks, ...rest }: Saved) {
  const index = JSON.stringify({
    ...rest,
    threadIds: threads.map((t) => t.id),
  } satisfies SavedIndex);
  return {
    index,
    threads: Object.fromEntries(
      threads.map((t) => [
        t.id,
        encodeThread(t, checkpoints[t.id], forks[t.id]),
      ]),
    ),
  };
}

const decodeIndex = Schema.decodeUnknownOption(
  Schema.fromJsonString(Persist.SavedIndex),
);
const decodeThread = Schema.decodeUnknownOption(
  Schema.fromJsonString(Persist.SavedThread),
);

/**
 * The index and thread files joined, each validated and upgraded (`Persist`); a `threads.json` from before the split is the
 * whole save in the index. Null when the index is none this version reads. A thread file that won't decode costs that
 * thread, not the others.
 */
export function joinSaved({ index, threads }: SavedFiles): Saved | null {
  const whole = decodeSaved(index);
  if (whole) return whole;
  const head = decodeIndex(index);
  if (head._tag === 'None') return null;
  const { v: _, threadIds: _ids, ...rest } = head.value;
  const parts = threads.flatMap((text) => {
    const part = decodeThread(text);
    return part._tag === 'Some' ? [part.value] : [];
  });
  return fromDecoded({
    ...rest,
    v: 1,
    threads: parts.map((p) => p.thread),
    checkpoints: Object.fromEntries(
      parts.flatMap((p) =>
        p.checkpoints ? [[p.thread.id, p.checkpoints]] : [],
      ),
    ),
    forks: Object.fromEntries(
      parts.flatMap((p) => (p.fork ? [[p.thread.id, p.fork]] : [])),
    ),
  });
}

// Reducers replace a thread only when it changes, so an unchanged thread skips JSON.stringify and compares as the same string.
const encoded = new WeakMap<Thread, SavedThread & { json: string }>();

function encodeThread(
  thread: Thread,
  checkpoints: Checkpoint[] | undefined,
  fork: Fork | undefined,
): string {
  const hit = encoded.get(thread);
  if (hit && hit.checkpoints === checkpoints && hit.fork === fork)
    return hit.json;
  const json = JSON.stringify({
    thread,
    checkpoints,
    fork,
  } satisfies SavedThread);
  encoded.set(thread, { thread, checkpoints, fork, json });
  return json;
}
