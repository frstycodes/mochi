import type { StreamFrame } from '../host/types/remote.ts';
import type { Action, State } from '../store/index.tsx';
import { mirrorState, reducer } from '../store/root.ts';
import type { Saved } from '../store/persist.ts';
import { rankQueue } from '../store/queue.ts';
import { lastActivityAt } from '../reorder.ts';

/** Another computer's store as this one follows it: rebuilt from its snapshot, then each of its actions in order. */
export interface Mirror {
  epoch: string;
  seq: number;
  state: State;
}

/**
 * Every action goes through the store's own root reducer, the machine's local UI actions (layout, panes) included: they land
 * in the scratch store's own layout slices, and a device reads only threads and the queue. Nothing runs but the reducer, so
 * no agent, schedule or file on this computer moves. An action out of order (another epoch, or one already applied) waits
 * for the snapshot that follows it.
 */
export function applyFrame(mirror: Mirror | undefined, frame: StreamFrame): Mirror | undefined {
  if (frame.type === 'snapshot') return { epoch: frame.epoch, seq: frame.seq, state: mirrorState(frame.saved as Saved) };
  if (!mirror || frame.epoch !== mirror.epoch || frame.seq <= mirror.seq) return mirror;
  return { ...mirror, seq: frame.seq, state: reducer(mirror.state, frame.action as Action) };
}

/** What a device can answer on that machine: its agents' questions and approvals, most blocking first. */
export function remoteDecisions(state: State) {
  return rankQueue(state.queue.filter((q) => (q.kind === 'approval' || q.kind === 'question') && !q.tool));
}

/** A machine's threads for its sidebar group, latest activity first: active ones, and settled ones folded below. */
export function remoteThreads(state: State) {
  const threads = [...state.threads].sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
  return { active: threads.filter((t) => t.status !== 'settled'), settled: threads.filter((t) => t.status === 'settled') };
}
