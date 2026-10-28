import type { MirrorFrame } from '../host/types/remote.ts';
import type { State } from '../store/types.ts';
import { mirrorState } from '../store/root.ts';
import { rankQueue } from '../store/queue.ts';
import { savedThreadFrom, type SavedThread } from '../store/saved.ts';
import { isListed } from '../model.ts';
import { lastActivityAt, pinnedThreads, settledThreads } from '../reorder.ts';
import { remoteThreadId } from './ids.ts';

/** One thread's file as the machine saves it. */
export type MirroredThread = SavedThread;

/** Another computer's store as this one follows it: its thread files as its `thread` streams last sent them. */
export interface Mirror {
  /** By the machine's own (bare) id, as the stream and the cache carry them. */
  threads: Record<string, MirroredThread>;
  /** Every thread id in it machine-aware (`remoteThreadId`), so it never collides with this computer's or another's. */
  state: State;
}

/**
 * Builds a store from the thread files alone, through the store's own initial state, so nothing runs: no agent, schedule
 * or file on this computer moves. A file that isn't a `Persist.SavedThread` leaves the mirror as it was.
 */
export function applyFrame(
  machineId: string,
  mirror: Mirror | undefined,
  frame: MirrorFrame,
): Mirror {
  if (frame.type === 'reset') return mirrorOf(machineId, {});
  const { [frame.threadId]: _replaced, ...rest } = mirror?.threads ?? {};
  if (frame.saved === null) return mirrorOf(machineId, rest);
  const saved = savedThreadFrom(frame.saved);
  return saved
    ? mirrorOf(machineId, { ...rest, [frame.threadId]: saved })
    : (mirror ?? mirrorOf(machineId, {}));
}

/** A mirror as `useMachines` cached it: each thread file decoded, one that won't decode left out. */
export function cachedMirror(
  machineId: string,
  threads: Record<string, unknown>,
): Mirror {
  return mirrorOf(
    machineId,
    Object.fromEntries(
      Object.entries(threads).flatMap(([id, file]) => {
        const saved = savedThreadFrom(file);
        return saved ? [[id, saved]] : [];
      }),
    ),
  );
}

/**
 * GAP: the machine's queue (approvals and questions) is in its index, which no stream carries yet, so a mirror has none;
 * `remoteDecisions` and ask alerts stay empty until the `shell` stream sends it.
 */
export function mirrorOf(
  machineId: string,
  threads: Record<string, MirroredThread>,
): Mirror {
  const files = Object.values(threads).map((f) => prefixed(machineId, f));
  const checkpoints = Object.fromEntries(
    files.flatMap((f) => (f.checkpoints ? [[f.thread.id, f.checkpoints]] : [])),
  );
  const forks = Object.fromEntries(
    files.flatMap((f) => (f.fork ? [[f.thread.id, f.fork]] : [])),
  );
  const state = mirrorState({
    version: 1,
    now: 0,
    seq: 0,
    threads: files.map((f) => f.thread),
    queue: [],
    checkpoints,
    checkpointSeq: 0,
    forks,
  });
  return { threads, state };
}

/** Keys whose string value names a thread, at any depth of a thread file (sub-thread links, replies, reports, proposals). */
const THREAD_ID_KEYS = new Set(['threadId', 'otherThreadId', 'parentId']);

/** Each file's prefixed copy, so a frame re-prefixes only the thread it changed. */
const prefixedFiles = new WeakMap<
  MirroredThread,
  { machineId: string; file: MirroredThread }
>();

/**
 * The file with every thread id in it machine-aware: its own id, and any `threadId` / `otherThreadId` / `parentId` it
 * holds. The queue, once mirrored (GAP above), takes the same prefix on its items' `threadId` and `id`.
 */
function prefixed(machineId: string, file: MirroredThread): MirroredThread {
  const known = prefixedFiles.get(file);
  if (known?.machineId === machineId) return known.file;
  const withIds = prefixIds(machineId, file) as MirroredThread;
  const result = {
    ...withIds,
    thread: {
      ...withIds.thread,
      id: remoteThreadId(machineId, file.thread.id),
    },
  };
  prefixedFiles.set(file, { machineId, file: result });
  return result;
}

function prefixIds(machineId: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => prefixIds(machineId, v));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      THREAD_ID_KEYS.has(key) && typeof v === 'string'
        ? remoteThreadId(machineId, v)
        : prefixIds(machineId, v),
    ]),
  );
}

/** What a device can answer on that machine: its agents' questions and approvals, most blocking first. */
export function remoteDecisions(state: State) {
  return rankQueue(
    state.queue.filter(
      (q) => (q.kind === 'approval' || q.kind === 'question') && !q.tool,
    ),
  );
}

/** A machine's threads for its sidebar group: active ones by latest activity, and settled ones folded below, latest settled first. Its pins show in Pinned. */
export function remoteThreads(state: State) {
  const pinned = new Set(
    pinnedThreads(state.threads, state.spaceId).map((t) => t.id),
  );
  const threads = state.threads.filter((t) => !pinned.has(t.id) && isListed(t));
  return {
    active: threads
      .filter((t) => t.status !== 'settled')
      .sort((a, b) => lastActivityAt(b) - lastActivityAt(a)),
    settled: settledThreads(threads),
  };
}
