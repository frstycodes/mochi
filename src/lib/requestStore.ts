import { useSyncExternalStore } from 'react';

/** A module-level slot for a viewer mounted once at the app root: `open` replaces the request (`null` closes), `use` reads it. */
export function createRequestStore<T>() {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    open(request: T | null) {
      current = request;
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, () => current),
  };
}
