import { useSyncExternalStore } from 'react';

let isOpen = false;
const listeners = new Set<() => void>();

/** Cmd K and the sidebar footer menu open Settings; `SettingsDialog`, mounted once in `App`, renders it. */
export function openSettings(open = true) {
  isOpen = open;
  listeners.forEach((l) => l());
}

export function useSettingsOpen() {
  return useSyncExternalStore(subscribe, () => isOpen);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
