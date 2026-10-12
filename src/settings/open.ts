import { useSyncExternalStore } from 'react';
import type { Provider } from '../model';
import type { SectionId } from './sections';

/** `nonce` re-triggers the scroll-and-flash when the same setting is deep-linked twice. */
export interface SettingsRoute {
  section: SectionId;
  settingId?: string;
  nonce: number;
}

let route: SettingsRoute | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

/** Opens the settings page (⌘, / Ctrl+,, the palette, the profile menu); `settingId` scrolls to that row and flashes it. */
export function openSettings(section: SectionId = 'general', settingId?: string) {
  set({ section, settingId, nonce: ++nonce });
}

let requestedHarness: Provider | null = null;

/** A profile's MCP servers or skills, opened on one harness: the thread context panel links here for the thread's profile. */
export function openProfileConfig(spaceId: string, part: 'mcp' | 'skills', provider: Provider) {
  requestedHarness = provider;
  openSettings('profiles', `${spaceId}-${part}`);
}

/** The harness the last `openProfileConfig` asked for, once. */
export function takeRequestedHarness() {
  const provider = requestedHarness;
  requestedHarness = null;
  return provider;
}

/** Back to the app: the layout lives in the store, so the splits and views come back as they were. */
export function closeSettings() {
  set(null);
}

export function useSettingsRoute() {
  return useSyncExternalStore(subscribe, () => route);
}

function set(next: SettingsRoute | null) {
  route = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
