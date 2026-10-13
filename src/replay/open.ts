import { useSyncExternalStore } from 'react';

let threadId: string | null = null;
const listeners = new Set<() => void>();

/** Opens the replay page over the app (thread menu, ⌘K); the layout stays in the store underneath. */
export function openReplay(id: string) {
  set(id);
}

export function closeReplay() {
  set(null);
}

export function useReplayRoute() {
  return useSyncExternalStore(subscribe, () => threadId);
}

function set(next: string | null) {
  threadId = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
