import type { MouseEvent } from 'react';
import { openExternally } from '../browser/systemBrowser';
import { useDispatch } from '../store';
import { useVizThreadId } from '../viz/WidgetVisual';
import { linkTarget } from './linkTarget';

/** A click handler for `onClick` and `onAuxClick` that opens `url` in the thread's browser tab, or the system browser on ⌘/Ctrl-click or middle click. */
export function useOpenLink() {
  return useOpenLinkIn(useVizThreadId());
}

/** `useOpenLink` for a link that names its thread, where no `VizThreadProvider` wraps it (a sidebar or notification card). */
export function useOpenLinkIn(threadId: string) {
  const dispatch = useDispatch();
  return (e: MouseEvent, url: string) => {
    const target = linkTarget(e);
    if (!target) return;
    // Stops the window navigating to the href, and a middle click opening it as a new window.
    e.preventDefault();
    if (target === 'external') openExternally(url);
    else dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url });
  };
}
