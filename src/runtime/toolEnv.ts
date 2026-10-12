import { toast } from 'sonner';
import { getPage, updatePage } from '../browser/pages.ts';
import { setWorktreePath, worktreePath } from '../git/worktrees.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import { getPrefs, setPrefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import type { ToolEnv } from './tools.ts';

/** The app side of a Mochi tool run: sonner toasts, OS notifications, the browser pages and host. */
export function toolEnv(getState: () => State, dispatch: (action: Action) => void): ToolEnv {
  return {
    getState,
    dispatch,
    prefs: { get: getPrefs, set: setPrefs },
    toast: (text, onUndo) => toast(text, { ...(onUndo && { action: { label: 'Undo', onClick: onUndo } }) }),
    notify: (title, body) => {
      toast(title, { description: body });
      host.notify.show({ title, body }).catch(() => undefined);
    },
    removeWorktree: async (threadId) => {
      const path = worktreePath(threadId);
      if (!path) return;
      await host.git.removeWorktree(path);
      setWorktreePath(threadId, null);
    },
    pages: { get: getPage, update: updatePage },
    browser: host.browser,
    cwdOf: (thread) => thread.live?.cwd ?? threadCwd(thread),
    isDesktop: host.isDesktop,
  };
}
