import { host } from '../host/index.ts';
import { getPrefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { compact, linesFor, toLines, type ReplayLine } from './record.ts';

const FLUSH_MS = 1000;
const pending = new Map<string, ReplayLine[]>();
/** Threads whose recording has its base for this session; one that reached its cap stays off until the next launch. */
const started = new Set<string>();
const capped = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Called with the store just before each action (Settings › Data and storage › Record threads for replay). Lines collect for a second,
 * then go to main as one compacted append. Turning recording off forgets which threads have a base, so turning it back
 * on writes a fresh one and the replay jumps over the gap instead of replaying a store it never saw.
 */
export function recordAction(state: State, action: Action) {
  if (action.type === 'delete') return forget(action.threadIds);
  if (!getPrefs().recordReplays) return started.clear();
  const captured = linesFor(state, action, Date.now(), (id) => started.has(id));
  if (!captured || capped.has(captured.threadId)) return;
  started.add(captured.threadId);
  pending.set(captured.threadId, [
    ...(pending.get(captured.threadId) ?? []),
    ...captured.lines,
  ]);
  timer ??= setTimeout(flushReplays, FLUSH_MS);
}

/** Before reading a recording, so the replay includes the last second. */
export function flushReplays() {
  clearTimeout(timer);
  timer = undefined;
  const writes = [...pending].map(([threadId, lines]) =>
    host.data.appendReplay(threadId, toLines(compact(lines))).then(
      (isWritten) => void (!isWritten && capped.add(threadId)),
      (error: unknown) => console.error('Recording the replay failed', error),
    ),
  );
  pending.clear();
  return Promise.all(writes);
}

function forget(threadIds: string[]) {
  for (const id of threadIds) {
    pending.delete(id);
    started.delete(id);
  }
  host.data
    .clearReplays(threadIds)
    .catch((error: unknown) => console.error('Removing replays failed', error));
}

/** Clearing every recording in Settings: the next action of each thread writes a new base. */
export function forgetAllReplays() {
  pending.clear();
  started.clear();
  capped.clear();
}

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', () => void flushReplays());
