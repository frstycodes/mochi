import type { MirrorFrame } from '../host/types/remote.ts';
import type { State } from '../store/types.ts';
import { mirrorState } from '../store/root.ts';
import { rankQueue } from '../store/queue.ts';
import { savedThreadFrom, type SavedThread } from '../store/saved.ts';
import { isListed } from '../model.ts';
import { lastActivityAt, pinnedThreads, settledThreads } from '../reorder.ts';

/** One thread's file as the machine saves it. */
export type MirroredThread = SavedThread;

/** Another computer's store as this one follows it: its thread files as its `thread` streams last sent them. */
export interface Mirror {
  threads: Record<string, MirroredThread>;
  state: State;
}

/**
 * Builds a store from the thread files alone, through the store's own initial state, so nothing runs: no agent, schedule
 * or file on this computer moves. A file that isn't a `Persist.SavedThread` leaves the mirror as it was.
 */
export function applyFrame(
  mirror: Mirror | undefined,
  frame: MirrorFrame,
): Mirror {
  if (frame.type === 'reset') return mirrorOf({});
  const { [frame.threadId]: _replaced, ...rest } = mirror?.threads ?? {};
  if (frame.saved === null) return mirrorOf(rest);
  const saved = savedThreadFrom(frame.saved);
  return saved
    ? mirrorOf({ ...rest, [frame.threadId]: saved })
    : (mirror ?? mirrorOf({}));
}

/** A mirror as `useMachines` cached it: each thread file decoded, one that won't decode left out. */
export function cachedMirror(threads: Record<string, unknown>): Mirror {
  return mirrorOf(
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
export function mirrorOf(threads: Record<string, MirroredThread>): Mirror {
  const files = Object.values(threads);
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

/** What a device can answer on that machine: its agents' questions and approvals, most blocking first. */
export function remoteDecisions(state: State) {
  return rankQueue(
    state.queue.filter(
      (q) => (q.kind === 'approval' || q.kind === 'question') && !q.tool,
    ),
  );
}

/** A machine's threads for its sidebar group: active ones by latest activity, and settled ones folded below, latest archived first. Its pins show in Pinned. */
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
