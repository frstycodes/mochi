import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** A shared wall clock per granularity, stopped while hidden or unused. Null leaves the clock idle. */
export function useNow(granularity: number | null = 1000) {
  const clock = clockFor(granularity);
  const now = useStore(clock.store, (s) => s.now);
  useEffect(() => clock.retain(), [clock]);
  // oxlint-disable-next-line react/purity -- an idle clock (null) reads the time whenever its caller renders for another reason
  return now ?? Date.now();
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
  const store = createStore<{ now: number | null }>(() => ({
    now: granularity === null ? null : Date.now(),
  }));
  let timer: ReturnType<typeof setInterval> | undefined;
  let users = 0;
  const tick = () => store.setState({ now: Date.now() });
  const sync = () => {
    clearInterval(timer);
    if (document.hidden) return;
    tick();
    timer = setInterval(tick, granularity!);
  };
  return {
    store,
    /** Runs the clock until the returned release; the last release stops it. */
    retain(this: void) {
      if (granularity === null) return () => {};
      if (++users === 1) {
        document.addEventListener('visibilitychange', sync);
        sync();
      }
      return () => {
        if (--users) return;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', sync);
      };
    },
  };
}
