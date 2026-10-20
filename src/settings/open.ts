import { useEffect, useState, useSyncExternalStore } from 'react';
import { setLibraryScope } from '../library/libraryScope';
import type { SectionId } from './sections';

/** `nonce` re-triggers the scroll-and-flash when the same setting is deep-linked twice. `subpage` is one item's own page inside the section (a connector). */
export interface SettingsRoute {
  section: SectionId;
  settingId?: string;
  subpage?: string;
  nonce: number;
}

let route: SettingsRoute | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

/** Opens the settings page (⌘, / Ctrl+,, the palette, the profile menu); `settingId` scrolls to that row and flashes it. */
export function openSettings(section: SectionId = 'chat', settingId?: string) {
  set({ section, settingId, nonce: ++nonce });
}

/** One item's own page inside a section, like Settings › Connectors › Linear; Esc or its back link return to the section. */
export function openSubpage(section: SectionId, subpage: string, settingId?: string) {
  set({ section, subpage, settingId, nonce: ++nonce });
}

/** A thread's skills or MCP servers: the thread context panel opens Skills or Connectors scoped to the thread's profile. */
export function openProfileConfig(spaceId: string, part: 'mcp' | 'skills') {
  setLibraryScope(spaceId);
  openSettings(part === 'mcp' ? 'connectors' : 'skills');
}

/** Back to the app: the layout lives in the store, so the splits and views come back as they were. */
export function closeSettings() {
  set(null);
}

export function useSettingsRoute() {
  return useSyncExternalStore(subscribe, () => route);
}

/** A tab that follows deep links: `tabFor` names the tab a setting id lives on, or undefined when the id doesn't say. */
export function useLinkedTab<T extends string>(tabFor: (settingId: string) => T | undefined, fallback: T) {
  const route = useSettingsRoute();
  const linked = () => (route?.settingId ? tabFor(route.settingId) : undefined);
  const [tab, setTab] = useState<T>(() => linked() ?? fallback);
  useEffect(() => {
    const next = linked();
    if (next) setTab(next);
  }, [route?.nonce, route?.settingId]);
  return [tab, setTab] as const;
}

function set(next: SettingsRoute | null) {
  route = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
