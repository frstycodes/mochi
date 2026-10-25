import { persistedSlice } from '../lib/uiStorage.ts';
import { useStore } from 'zustand';

const KEY = 'harness.worktrees';

const pathsSlice = persistedSlice<Record<string, string>>(KEY, {});
export function worktreePath(threadId: string): string | undefined {
  return pathsSlice.getState().value[threadId];
}

export function useWorktreePath(threadId: string) {
  return useStore(pathsSlice, (s) => s.value[threadId]);
}

export function useWorktreePaths() {
  return useStore(pathsSlice, (s) => s.value);
}

export function setWorktreePath(threadId: string, path: string | null) {
  const { [threadId]: _, ...rest } = pathsSlice.getState().value;
  pathsSlice.setState({ value: path ? { ...rest, [threadId]: path } : rest });
}
