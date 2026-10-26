import { persistedSlice } from '../lib/uiStorage.ts';
import { useStore } from 'zustand';
import { host } from '../host/index.ts';

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

/** Removes the thread's worktree, if it has one; git refuses a dirty one and the promise rejects with why. */
export async function removeThreadWorktree(threadId: string) {
  const path = worktreePath(threadId);
  if (!path) return;
  await host.git.removeWorktree(path);
  setWorktreePath(threadId, null);
}
