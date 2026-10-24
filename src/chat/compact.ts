import { isWorking } from '../agentPhase.ts';
import type { Thread } from '../model.ts';

export { compactFocus, compactInstructions, compactionEntry, keptContext, KEEP_CHARS, PIN_CHARS, restoreNote } from './compaction.ts';

/** Whether `/compact` can run now: `run`, `queue` behind a working turn (a compaction can't steer one), or `off` with why. */
export type CompactGate = { kind: 'run' } | { kind: 'queue' } | { kind: 'off'; reason: string };

export function compactGate(thread: Thread, isWaitingOnYou = false): CompactGate {
  const { live } = thread;
  if (!live || !thread.session) return off('Nothing to compact until the agent has started');
  if (live.isDetached) return off('Send a message first: the agent reconnects with it');
  if (live.starting) return off('The agent is still starting');
  if (isCompacting(thread)) return off('Already compacting');
  if (isWaitingOnYou) return off('Answer the agent first');
  return isWorking(thread) ? { kind: 'queue' } : { kind: 'run' };
}

const off = (reason: string): CompactGate => ({ kind: 'off', reason });

export function isCompacting(thread: Thread) {
  return thread.activity.findLast((e) => e.compaction)?.compaction?.status === 'running';
}
