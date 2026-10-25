import { useSyncExternalStore } from 'react';
import { host } from '../host/index.ts';
import type { Trigger } from '../host/types/schedule.ts';
import { nextRun } from './cron.ts';

// Core owns the triggers; every window mirrors them from `list` and `onChange`.
let triggers: Trigger[] = [];
const listeners = new Set<() => void>();
let isLoaded = false;

function load() {
  if (isLoaded) return;
  isLoaded = true;
  host.schedule.onChange((next) => set(next));
  host.schedule
    .list()
    .then(set, (error: unknown) =>
      console.error('Loading schedules failed', error),
    );
}

function set(next: Trigger[]) {
  triggers = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useSchedules() {
  return useSyncExternalStore(subscribe, () => triggers);
}

export function useTrigger(threadId: string) {
  return useSchedules().find((t) => t.threadId === threadId);
}

/** Null for PR triggers (they fire on events) and paused ones. */
export function triggerNextRun(trigger: Trigger, now = Date.now()) {
  if (trigger.isPaused || trigger.when.kind !== 'cron') return null;
  return nextRun(trigger.when.cron, Math.max(now, trigger.checkedAt));
}
