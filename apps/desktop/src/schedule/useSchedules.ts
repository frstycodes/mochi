import { useQuery } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import type { Trigger } from '../host/types/schedule.ts';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { nextRun } from '@mochi/domain/schedule/cron';
import { useOptionalMachines } from '../remote/useMachines.tsx';

const NONE: Trigger[] = [];
let isWatching = false;

// Core owns the triggers; every window mirrors them from `list` and `onChange`.
function listTriggers() {
  if (!isWatching) {
    isWatching = true;
    host.schedule.onChange((next) =>
      queryClient.setQueryData(queryKeys.schedules(), next),
    );
  }
  return host.schedule.list();
}

const schedulesOptions = {
  queryKey: queryKeys.schedules(),
  queryFn: listTriggers,
  staleTime: Infinity,
};

export function useSchedules() {
  return useQuery(schedulesOptions).data ?? NONE;
}

/** This computer's thread's trigger. */
export function useTrigger(threadId: string) {
  return useQuery({
    ...schedulesOptions,
    select: (all) => all.find((t) => t.threadId === threadId),
  }).data;
}

/**
 * Another computer's thread's trigger (a machine-aware id), as that computer lists it (`schedules`, re-read each minute).
 * Its own hook, so this computer's rows never subscribe to the followed machines.
 */
export function useRemoteTrigger(remote: {
  machineId: string;
  threadId: string;
}) {
  return useRemoteTriggers(remote.machineId)?.find(
    (t) => t.threadId === remote.threadId,
  );
}

const REMOTE_SCHEDULES_MS = 60_000;

/** Every trigger on another computer this one follows; undefined until read, or while it's offline. */
function useRemoteTriggers(machineId: string) {
  const machines = useOptionalMachines();
  const machine = machines?.machines.find(
    (m) => m.machine.id === machineId,
  )?.machine;
  return useQuery({
    queryKey: queryKeys.remote.schedules(machineId),
    queryFn: () => machines!.ask(machineId, { type: 'schedules' }),
    enabled: machine?.status === 'online' && machine.scopes.includes('read'),
    refetchInterval: REMOTE_SCHEDULES_MS,
    staleTime: REMOTE_SCHEDULES_MS,
  }).data;
}

/** After changing another computer's schedule: its triggers again, now. */
export const refreshRemoteTriggers = (machineId: string) =>
  queryClient.invalidateQueries({
    queryKey: queryKeys.remote.schedules(machineId),
  });

/** Null for PR triggers (they fire on events) and paused ones. */
export function triggerNextRun(trigger: Trigger, now = Date.now()) {
  if (trigger.isPaused || trigger.when.kind !== 'cron') return null;
  return nextRun(trigger.when.cron, Math.max(now, trigger.checkedAt));
}
