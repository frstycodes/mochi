import type { Dispatch } from 'react';

/** The store as components read it: the newest state, a change signal, and the way to change it. */
export interface HarnessStore<S, A> {
  getState: () => S;
  subscribe: (listener: () => void) => () => void;
  dispatch: Dispatch<A>;
}

/**
 * State held outside React, so a component re-renders only when what it selects changes. `defer` changes the state at once but
 * tells subscribers on the next frame, so a burst (an agent streaming tokens) renders once per frame; `set` tells them now,
 * along with anything deferred before it.
 */
export function createExternalState<S>(initial: S, schedule = nextFrame) {
  let state = initial;
  let cancel: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    cancel?.();
    cancel = null;
    listeners.forEach((l) => l());
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: S) => {
      if (next === state && !cancel) return;
      state = next;
      notify();
    },
    defer: (next: S) => {
      if (next === state) return;
      state = next;
      cancel ??= schedule(notify);
    },
  };
}

// A hidden window gets no animation frames; the timeout keeps its store moving, at a slower pace.
const FRAME_FALLBACK_MS = 100;

function nextFrame(run: () => void) {
  const frame = requestAnimationFrame(run);
  const timer = setTimeout(run, FRAME_FALLBACK_MS);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

/** A store over state that React already holds (a mirror, a replay): every new state is a new store, so every reader re-renders. */
export function fixedStore<S, A>(state: S, dispatch: Dispatch<A>): HarnessStore<S, A> {
  return { getState: () => state, subscribe: () => () => undefined, dispatch };
}

/** Equal when both hold the same values under the same keys (arrays: the same items in order). */
export function shallowEqual<T>(a: T, b: T) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && Object.is(a[k as keyof T], b[k as keyof T]));
}
