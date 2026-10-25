import { useEffect, useState } from 'react';
import { useRouterState, type HistoryState } from '@tanstack/react-router';
import { isTyping } from '../keys';
import { isCommand, listenKeydown } from '../keymap';
import { setLibraryScope } from '../library/libraryScope';
import type { SectionId } from '../settings/sections';
import {
  remoteRouteOf,
  replayThreadOf,
  settingsRouteOf,
  type RemoteThreadRoute,
} from './locations';
import { getRouter } from './router';

let nonce = 0;

/** Opens the settings page (⌘, / Ctrl+,, the palette, the profile menu); `settingId` scrolls to that row and flashes it. Inside settings it replaces, so Back leaves them in one step. */
export function openSettings(section: SectionId = 'chat', settingId?: string) {
  void getRouter().navigate({
    to: '/settings/$section',
    params: { section },
    search: { setting: settingId },
    state: nextNonce(),
    replace: isSettingsOpen(),
  });
}

/** One item's own page inside a section, like Settings › Connectors › Linear; Back or Esc return to the section. `replace` for a redirect, which Back must not re-trigger. */
export function openSubpage(
  section: SectionId,
  subpage: string,
  settingId?: string,
  replace = false,
) {
  void getRouter().navigate({
    to: '/settings/$section',
    params: { section },
    search: { setting: settingId, subpage },
    state: nextNonce(),
    replace,
  });
}

/** A thread's skills or MCP servers: the thread context panel opens Skills or Connectors scoped to the thread's profile. */
export function openProfileConfig(spaceId: string, part: 'mcp' | 'skills') {
  setLibraryScope(spaceId);
  openSettings(part === 'mcp' ? 'connectors' : 'skills');
}

/** The replay page over the app (thread menu, ⌘K); the layout stays in the store underneath. */
export function openReplay(threadId: string) {
  void getRouter().navigate({ to: '/replay/$threadId', params: { threadId } });
}

/** Another computer's thread over the app, like a replay. Between two remote threads it replaces, so Back leaves them. */
export function openRemoteThread({ machineId, threadId }: RemoteThreadRoute) {
  void getRouter().navigate({
    to: '/remote/$machineId/$threadId',
    params: { machineId, threadId },
    replace: !!remoteRouteOf(getRouter().state.location),
  });
}

export function openDeveloper() {
  void getRouter().navigate({ to: '/developer' });
}

/** The previous page; the workspace when this one was the first. */
export function goBack() {
  const { history } = getRouter();
  if (history.canGoBack()) history.back();
  else goHome();
}

/** Back to the app: the layout lives in the store, so the splits and views come back as they were. */
export function goHome() {
  void getRouter().navigate({ to: '/', replace: true });
}

// The history state is typed closed; the nonce rides in it so a repeated deep link is a new navigation.
function nextNonce() {
  return { nonce: ++nonce } as HistoryState;
}

function isSettingsOpen() {
  return !!settingsRouteOf(getRouter().state.location);
}

/** Esc goes back, unless it's closing a menu or popover first, or leaving a text field (then a second Esc goes back). */
export function useEscapeBack() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isCommand(e, 'dismiss') || e.defaultPrevented) return;
      if (
        document.querySelector(
          '[data-radix-popper-content-wrapper], [role=dialog], [role=alertdialog]',
        )
      )
        return;
      if (isTyping(e.target)) return void (e.target as HTMLElement).blur();
      goBack();
    };
    return listenKeydown(onKey);
  }, []);
}

/** Null while another page is showing. */
export function useSettingsRoute() {
  const location = useLocation();
  return settingsRouteOf(location);
}

export function useReplayRoute() {
  return replayThreadOf(useLocation());
}

export function useRemoteThreadRoute() {
  const location = useLocation();
  return remoteRouteOf(location);
}

export function usePathname() {
  return useLocation().pathname;
}

/** A tab that follows deep links: `tabFor` names the tab a setting id lives on, or undefined when the id doesn't say. */
export function useLinkedTab<T extends string>(
  tabFor: (settingId: string) => T | undefined,
  fallback: T,
) {
  const route = useSettingsRoute();
  const linked = () => (route?.settingId ? tabFor(route.settingId) : undefined);
  const [tab, setTab] = useState<T>(() => linked() ?? fallback);
  const link = `${route?.nonce}:${route?.settingId}`;
  const [followed, setFollowed] = useState(link);
  if (followed !== link) {
    setFollowed(link);
    const next = linked();
    if (next) setTab(next);
  }
  return [tab, setTab] as const;
}

// Read from the instance, not context: the design page and the shell's sidebars sit outside the RouterProvider.
function useLocation() {
  return useRouterState({ router: getRouter(), select: (s) => s.location });
}
