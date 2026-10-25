import { useSyncExternalStore } from 'react';

/** Where the title is edited: in the thread's sidebar row when the rename started there, else a dialog (⌘K, the thread header's menu). */
export type RenameSurface = 'row' | 'dialog';

let renaming: { threadId: string; surface: RenameSurface } | null = null;
const listeners = new Set<() => void>();

export function startRename(threadId: string, surface: RenameSurface) {
  renaming = { threadId, surface };
  listeners.forEach((l) => l());
}

export function endRename() {
  renaming = null;
  listeners.forEach((l) => l());
}

/** Where this thread is being renamed, if it is. */
export function useRenameSurface(threadId: string) {
  return useSyncExternalStore(subscribe, () =>
    renaming?.threadId === threadId ? renaming.surface : undefined,
  );
}

/** The thread being renamed in the dialog. */
export function useDialogRename() {
  return useSyncExternalStore(subscribe, () =>
    renaming?.surface === 'dialog' ? renaming.threadId : undefined,
  );
}

/**
 * The title to save, or undefined when there's nothing to save. Compared with the title the edit started from, not the current
 * one: the agent may rename the thread mid-edit, and leaving the field untouched then keeps the agent's title.
 */
export function titleToSave(startedFrom: string, text: string) {
  const title = text.trim();
  return title && title !== startedFrom ? title : undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
