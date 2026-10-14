import { useSyncExternalStore } from 'react';

export interface RemoteThreadRoute {
  machineId: string;
  threadId: string;
}

let route: RemoteThreadRoute | null = null;
const listeners = new Set<() => void>();

/** Opens another computer's thread over the app, like a replay; the layout stays in the store underneath. */
export function openRemoteThread(next: RemoteThreadRoute) {
  set(next);
}

export function closeRemoteThread() {
  set(null);
}

export function useRemoteThreadRoute() {
  return useSyncExternalStore(subscribe, () => route);
}

function set(next: RemoteThreadRoute | null) {
  route = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
