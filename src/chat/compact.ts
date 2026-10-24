import { isWorking } from '../agentPhase.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { getThreadPins, type Pin } from './pins.ts';
import { compactInstructions, keptContext } from './compaction.ts';
import { parseSlash } from './slash.ts';

export { compactInstructions, compactionEntry, keptContext, KEEP_CHARS, PIN_CHARS, restoreNote } from './compaction.ts';

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

/** `/compact focus` → `'focus'`; anything else → null. Queued messages carry it as typed. */
export function compactFocus(text: string) {
  const command = parseSlash(text);
  return command?.command.name === 'compact' ? command.arg : null;
}

/** Keeps Core's copy of a live Claude thread's instructions current, so auto-compaction keeps your pins too. */
export function sendCompactInstructions(thread: Thread, pins: Pin[] = getThreadPins(thread.id)) {
  if (!thread.live || thread.session?.provider !== 'claude') return;
  host.agent.compactInstructions(thread.id, compactInstructions(keptContext(thread, pins))).catch((error: unknown) => console.error('Sending compaction instructions failed', error));
}
