import type { Thread } from '../model.ts';
import type { Saved } from '../store/persist.ts';
import type { State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import type { Recording, ReplayBase, ReplayStep } from './record.ts';

/** A store holding only the recorded thread, as it stood when recording began. The other slices never touch threads or the queue. */
export function scratchState({ now, base }: ReplayBase): State {
  const saved = { version: 1, now, seq: 1, threads: [base.thread], queue: base.queue, checkpoints: {}, checkpointSeq: 0, forks: {} } satisfies Saved;
  return { ...initialThreads(saved, false), ...initialQueue(saved, false), spaceId: base.thread.spaceId, views: {} } as unknown as State;
}

/** The store's own slices that own threads and the queue, in the store's order, at the app clock the step was recorded on. */
export function applyStep(state: State, { now, action }: ReplayStep): State {
  const at = { ...state, now };
  return queueReducer(threadsReducer(at, action), action);
}

const SNAPSHOT_EVERY = 32;

/** The store after the first `n` steps; scrubbing back starts from the nearest kept snapshot, playing forward from the last answer. */
export function createReplayer(recording: Recording) {
  const snapshots = new Map<number, State>([[0, scratchState(recording.base)]]);
  let last = { n: 0, state: snapshots.get(0)! };
  return function stateAt(n: number): State {
    const target = Math.max(0, Math.min(n, recording.steps.length));
    let i = target >= last.n ? last.n : Math.floor(target / SNAPSHOT_EVERY) * SNAPSHOT_EVERY;
    while (i !== last.n && !snapshots.has(i)) i -= SNAPSHOT_EVERY;
    let state = i === last.n ? last.state : snapshots.get(i)!;
    for (; i < target; i++) {
      state = applyStep(state, recording.steps[i]);
      if ((i + 1) % SNAPSHOT_EVERY === 0) snapshots.set(i + 1, state);
    }
    last = { n: target, state };
    return state;
  };
}

export function replayedThread(state: State, threadId: string): Thread | undefined {
  return state.threads.find((t) => t.id === threadId);
}

/** Longer pauses than this play as `SKIPPED_GAP_MS` when skipping idle gaps. */
export const IDLE_GAP_MS = 3000;
const SKIPPED_GAP_MS = 600;

/** Each step's place on the replay clock, in ms from the start; skipping idle gaps shortens every long pause. */
export function timeline(recording: Recording, skipIdle: boolean): number[] {
  let clock = 0;
  let previous = recording.base.t;
  return recording.steps.map(({ t }) => {
    const gap = Math.max(0, t - previous);
    previous = Math.max(previous, t);
    clock += skipIdle && gap > IDLE_GAP_MS ? SKIPPED_GAP_MS : gap;
    return clock;
  });
}

/** How many steps have played by `ms` on the replay clock. */
export function stepsBy(times: number[], ms: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type MarkerKind = 'you' | 'tool' | 'edit' | 'approval' | 'error';

export interface Marker {
  /** Steps played once the marked step has applied. */
  n: number;
  kind: MarkerKind;
  label: string;
}

/** The moments worth jumping to: your messages, tool calls, file edits, approvals and questions, failures. */
export function markers(recording: Recording): Marker[] {
  return recording.steps.flatMap(({ action }, i): Marker[] => {
    const n = i + 1;
    if (action.type === 'send') return [{ n, kind: 'you', label: action.text }];
    if (action.type !== 'agent') return [];
    const { event } = action;
    switch (event.type) {
      case 'tool':
        if (event.phase === 'start') return [{ n, kind: 'tool', label: event.text }];
        if (event.exitCode) return [{ n, kind: 'error', label: `Exit ${event.exitCode}: ${event.text}` }];
        return event.files?.length ? [{ n, kind: 'edit', label: event.files.join(', ') }] : [];
      case 'approval':
        return [{ n, kind: 'approval', label: event.title }];
      case 'question':
        return [{ n, kind: 'approval', label: event.questions[0]?.text ?? 'Question' }];
      case 'limit':
        return [{ n, kind: 'error', label: 'Usage limit reached' }];
      case 'turn-end':
        return event.status === 'failed' ? [{ n, kind: 'error', label: event.error ? `Turn failed: ${event.error}` : 'Turn failed' }] : [];
      default:
        return [];
    }
  });
}
