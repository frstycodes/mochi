import type { FollowedMachine } from '../host/types/remote.ts';
import type { Thread } from '../model.ts';
import { parseRemoteThreadId } from '../remote/ids.ts';
import { useMachines, type FollowedView } from '../remote/useMachines.tsx';
import { useThread } from './index.tsx';

/** A thread and the computer it runs on: null for this one. */
export interface AnyThread {
  thread: Thread;
  machine: FollowedMachine | null;
}

/** A thread by id wherever it runs: this computer's own, or another's mirrored one by its machine-aware id (`remoteThreadId`). */
export function findAnyThread(
  local: Thread | undefined,
  machines: FollowedView[],
  id: string,
): AnyThread | undefined {
  const remote = parseRemoteThreadId(id);
  if (!remote) return local && { thread: local, machine: null };
  const followed = machines.find((m) => m.machine.id === remote.machineId);
  const thread = followed?.state?.threads.find((t) => t.id === id);
  return thread && followed && { thread, machine: followed.machine };
}

export function useAnyThread(id: string) {
  const local = useThread(id);
  return findAnyThread(local, useMachines().machines, id);
}
