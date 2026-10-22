import type { Dispatch } from 'react';

/** The store as components read it: the newest state, a change signal, and the way to change it. */
export interface HarnessStore<S, A> {
  getState: () => S;
  subscribe: (listener: () => void) => () => void;
  dispatch: Dispatch<A>;
}

/** State held outside React, so a component re-renders only when what it selects changes. */
export function createExternalState<S>(initial: S) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: S) => {
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
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
