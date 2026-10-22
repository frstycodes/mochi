import { persistedSlice } from '../lib/uiStorage.ts';
import { useSyncExternalStore } from 'react';

const KEY = 'harness.worktrees';

const pathsSlice = persistedSlice<Record<string, string>>(KEY, {});
let paths = pathsSlice.getState().value;
const listeners = new Set<() => void>();

export function worktreePath(threadId: string): string | undefined {
  return paths[threadId];
}

export function useWorktreePath(threadId: string) {
  return useSyncExternalStore(subscribe, () => paths[threadId]);
}

export function useWorktreePaths() {
  return useSyncExternalStore(subscribe, () => paths);
}

export function setWorktreePath(threadId: string, path: string | null) {
  const { [threadId]: _, ...rest } = paths;
  paths = path ? { ...rest, [threadId]: path } : rest;
  pathsSlice.setState({ value: paths });
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
