import { useSyncExternalStore } from 'react';
import type { RewindMode } from './checkpoints.ts';
import type { ForkPoint } from './fork.ts';

/** What the rewind layer of a thread should show; menus, step rows and the timeline open these, `RewindLayer` renders them. */
export type RewindRequest =
  /** `n` or `message` (an activity index) confirms that rewind, in `mode` (default: the one you ran last); neither picks a checkpoint first. */
  | { kind: 'rewind'; threadId: string; n?: number; message?: number; mode?: RewindMode }
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
