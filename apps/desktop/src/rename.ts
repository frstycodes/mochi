import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Where the title is edited: in the thread's sidebar row when the rename started there, else a dialog (⌘K, the thread header's menu). */
export type RenameSurface = 'row' | 'dialog';

const renameStore = createStore<{
  renaming: { threadId: string; surface: RenameSurface } | null;
}>(() => ({ renaming: null }));

export function startRename(threadId: string, surface: RenameSurface) {
  renameStore.setState({ renaming: { threadId, surface } });
}

export function endRename() {
  renameStore.setState({ renaming: null });
}

/** Where this thread is being renamed, if it is. */
export function useRenameSurface(threadId: string) {
  return useStore(renameStore, ({ renaming }) =>
    renaming?.threadId === threadId ? renaming.surface : undefined,
  );
}

/** The thread being renamed in the dialog. */
export function useDialogRename() {
  return useStore(renameStore, ({ renaming }) =>
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
