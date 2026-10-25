import { useQuery } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import type { Trigger } from '../host/types/schedule.ts';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { nextRun } from '@mochi/domain/schedule/cron';

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

export function useTrigger(threadId: string) {
  return useQuery({
    ...schedulesOptions,
    select: (all) => all.find((t) => t.threadId === threadId),
  }).data;
}

/** Null for PR triggers (they fire on events) and paused ones. */
export function triggerNextRun(trigger: Trigger, now = Date.now()) {
  if (trigger.isPaused || trigger.when.kind !== 'cron') return null;
  return nextRun(trigger.when.cron, Math.max(now, trigger.checkedAt));
}
