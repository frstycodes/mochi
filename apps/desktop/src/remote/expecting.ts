import type { Dispatch } from 'react';
import type { CommandResult } from '../host/types/remote.ts';
import type { Action } from '../store/index.tsx';
import { remoteThreadId } from './ids.ts';

/** A thread started on another computer is on its way into the mirror for this long before it counts as gone. */
const GRACE_MS = 15_000;

const until = new Map<string, number>();

/** Marks a machine-aware thread id as just created there: its leaf waits for the mirror instead of calling it gone. */
export function expectThread(id: string) {
  until.set(id, Date.now() + GRACE_MS);
}

/** Milliseconds left to wait for that thread to reach the mirror; 0 once it has, or was never expected. */
export function expectedFor(id: string) {
  const left = (until.get(id) ?? 0) - Date.now();
  if (left <= 0) until.delete(id);
  return Math.max(0, left);
}

/** Opens the thread a `create` command started on that machine in the focused split, waiting for the mirror; false when the result named none. */
export function openStarted(
  machineId: string,
  result: CommandResult,
  dispatch: Dispatch<Action>,
) {
  const data = result.isOk ? result.data : undefined;
  if (!data || !('threadId' in data)) return false;
  const id = remoteThreadId(machineId, data.threadId);
  expectThread(id);
  dispatch({ type: 'go', view: { kind: 'thread', id } });
  return true;
}
