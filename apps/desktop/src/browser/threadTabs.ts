import { useEffect } from 'react';
import type { Thread } from '../model.ts';
import { useDispatch, useHarnessSelector } from '../store';

/** Tabs this window has already been offered; one you close in the pane stays closed here. */
const offered = new Set<string>();

/**
 * The thread's browser tabs (folded in its Core: the agent's, another window's, a device's) as tabs of this window's pane,
 * opened in the background so the layout stays as you left it.
 * ponytail: closing one here doesn't close it on another computer's thread; a device has no command for that yet.
 */
export function useThreadBrowserTabs(thread: Thread) {
  const dispatch = useDispatch();
  const tabs = thread.browserTabs;
  const paneTabs = useHarnessSelector(
    (s) => s.panes.find((p) => p.threadId === thread.id)?.tabs,
  );
  useEffect(() => {
    for (const tab of tabs ?? []) {
      const key = `${thread.id}/${tab.id}`;
      if (offered.has(key)) continue;
      offered.add(key);
      if (paneTabs?.some((t) => t.id === tab.id)) continue;
      dispatch({
        type: 'pane-open-tab',
        threadId: thread.id,
        kind: 'browser',
        url: tab.url,
        title: tab.title || undefined,
        tabId: tab.id,
        isBackground: true,
      });
    }
  }, [dispatch, thread.id, tabs, paneTabs]);
}
