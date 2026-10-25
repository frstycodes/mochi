import { useSyncExternalStore } from 'react';

/** A shared wall clock per granularity, stopped while hidden or unused. Null leaves the clock idle. */
export function useNow(granularity: number | null = 1000) {
  const clock = clockFor(granularity);
  // oxlint-disable-next-line react/purity -- an idle clock (null) reads the time whenever its caller renders for another reason
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot) ?? Date.now();
}

const clocks = new Map<number | null, ReturnType<typeof createClock>>();

export function clockFor(granularity: number | null) {
  let clock = clocks.get(granularity);
  if (!clock) {
    clock = createClock(granularity);
    clocks.set(granularity, clock);
  }
  return clock;
}

function createClock(granularity: number | null) {
  let now: number | null = granularity === null ? null : Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const tick = () => {
    now = Date.now();
    listeners.forEach((listener) => listener());
  };
  const sync = () => {
    clearInterval(timer);
    if (document.hidden) return;
    tick();
    timer = setInterval(tick, granularity!);
  };
  return {
    getSnapshot: () => now,
    subscribe(this: void, listener: () => void) {
      if (granularity === null) return () => {};
      listeners.add(listener);
      if (listeners.size === 1) {
        document.addEventListener('visibilitychange', sync);
        sync();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', sync);
      };
    },
  };
}
