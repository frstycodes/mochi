import { useSyncExternalStore } from 'react';
import type { Space } from '../model';
import { useProfiles } from '../profiles';
import { useHarness } from '../store';

/**
 * The profile Settings › Skills, Plugins and Connectors show and install to, shared by the three pages and a connector's
 * own page. Unpicked, it follows the profile you're in; `ALL_PROFILES` is the whole library, handed out item by item.
 */
export const ALL_PROFILES = 'all';

let picked: string | null = null;
const listeners = new Set<() => void>();

export function setLibraryScope(id: string) {
  picked = id;
  listeners.forEach((l) => l());
}

/** `profile` is null for All profiles; `installTo` is where a new item goes: the profile, or every profile. */
export function useLibraryScope(): { id: string; profile: Space | null; installTo: string[] } {
  const chosen = useSyncExternalStore(subscribe, () => picked);
  const profiles = useProfiles();
  const { spaceId } = useHarness().state;
  if (chosen === ALL_PROFILES) return { id: ALL_PROFILES, profile: null, installTo: profiles.map((p) => p.id) };
  // A picked profile that was since removed falls back to the one you're in.
  const profile = profiles.find((p) => p.id === chosen) ?? profiles.find((p) => p.id === spaceId) ?? profiles[0];
  return { id: profile.id, profile, installTo: [profile.id] };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
