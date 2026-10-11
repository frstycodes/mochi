import { useSyncExternalStore } from 'react';
import type { ForkPoint } from './fork.ts';

/** What the rewind layer of a thread should show; menus, step rows and the timeline open these, `RewindLayer` renders them. */
export type RewindRequest =
  | { kind: 'rewind'; threadId: string; n?: number }
  | { kind: 'fork'; threadId: string; point?: ForkPoint }
  | { kind: 'handoff'; threadId: string; stepId?: string }
  | { kind: 'compare'; threadId: string; otherId: string };

let current: RewindRequest | null = null;
const listeners = new Set<() => void>();

export function openRewind(request: RewindRequest | null) {
  current = request;
  listeners.forEach((l) => l());
}

export function useRewindRequest(threadId: string) {
  const request = useSyncExternalStore(subscribe, () => current);
  return request?.threadId === threadId ? request : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
