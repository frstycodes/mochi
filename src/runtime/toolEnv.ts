import { toast } from '../toast/store.ts';
import { getPage, openPage, updatePage } from '../browser/pages.ts';
import { normalizeUrl } from '../browser/url.ts';
import { setWorktreePath, worktreePath } from '../git/worktrees.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import { getProfiles, removeProfile, updateProfile } from '../profiles.ts';
import { getPrefs, setPrefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import type { ToolEnv } from './tools.ts';

/** the app side of a Mochi tool run: toasts, OS notifications, the browser pages and host. */
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
    pages: { get: getPage, update: updatePage, open: (key, url, spaceId) => void openPage(key, normalizeUrl(url), spaceId) },
    browser: host.browser,
    cwdOf: threadCwd,
    models: (provider, spaceId) => host.agent.models(provider, spaceId).catch(() => []),
    profiles: { list: getProfiles, update: updateProfile, remove: (id) => void removeProfile(id) },
    theme: storedTheme,
    settings: host.settings,
    themes: host.themes,
    remote: host.remote,
    isDesktop: host.isDesktop,
    git: host.git,
  };
}

/** next-themes keeps the choice under `theme`; nothing stored (or storage blocked) means its default, System. */
function storedTheme() {
  try {
    return localStorage.getItem('theme') ?? 'system';
  } catch {
    return 'system';
  }
}
