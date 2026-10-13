import { useSyncExternalStore } from 'react';

let renamingId: string | null = null;
const listeners = new Set<() => void>();

/** Turns the thread header's title into a field (thread menu, ⌘K); null ends it. */
export function startRename(threadId: string | null) {
  renamingId = threadId;
  listeners.forEach((l) => l());
}

export function useIsRenaming(threadId: string) {
  return useSyncExternalStore(subscribe, () => renamingId === threadId);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
