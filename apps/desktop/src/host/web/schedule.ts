import type { ScheduleHost, Trigger } from '../types/schedule.ts';

// The web build has no agents: triggers live in memory so the editor and Settings work, and nothing ever runs.
let triggers: Trigger[] = [];
const listeners = new Set<(triggers: Trigger[]) => void>();
const changed = () => listeners.forEach((l) => l(triggers));

export const schedule: ScheduleHost = {
  async list() {
    return triggers;
  },
  async set(input) {
    const old = triggers.find((t) => t.threadId === input.threadId);
    const trigger = {
      ...input,
      isPaused: old?.isPaused ?? false,
      createdAt: old?.createdAt ?? Date.now(),
      checkedAt: Date.now(),
      runs: old?.runs ?? [],
    };
    triggers = [
      ...triggers.filter((t) => t.threadId !== input.threadId),
      trigger,
    ];
    changed();
  },
  async remove(threadId) {
    triggers = triggers.filter((t) => t.threadId !== threadId);
    changed();
  },
  async setPaused(threadId, isPaused) {
    triggers = triggers.map((t) =>
      t.threadId === threadId ? { ...t, isPaused } : t,
    );
    changed();
  },
  async runNow() {
    throw new Error('Scheduled runs need the desktop app');
  },
  async drain() {
    return [];
  },
  onChange(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  onEvent() {
    return () => {};
  },
};
