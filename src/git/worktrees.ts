import { useSyncExternalStore } from 'react';

const KEY = 'harness.worktrees';

let paths = load();
const listeners = new Set<() => void>();

export function worktreePath(threadId: string): string | undefined {
  return paths[threadId];
}

export function useWorktreePath(threadId: string) {
  return useSyncExternalStore(subscribe, () => paths[threadId]);
}

export function setWorktreePath(threadId: string, path: string | null) {
  const { [threadId]: _, ...rest } = paths;
  paths = path ? { ...rest, [threadId]: path } : rest;
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}
