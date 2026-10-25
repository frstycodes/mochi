import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Space } from '../model';
import { useProfiles } from '../profiles';
import { useHarnessSelector } from '../store';

/**
 * The profile Settings › Skills, Plugins and Connectors show and install to, shared by the three pages and a connector's
 * own page. Unpicked, it follows the profile you're in; `ALL_PROFILES` is the whole library, handed out item by item.
 */
export const ALL_PROFILES = 'all';

const scopeStore = createStore<{ picked: string | null }>(() => ({
  picked: null,
}));

export function setLibraryScope(id: string) {
  scopeStore.setState({ picked: id });
}

/** `profile` is null for All profiles; `installTo` is where a new item goes: the profile, or every profile. */
export function useLibraryScope(): {
  id: string;
  profile: Space | null;
  installTo: string[];
} {
  const chosen = useStore(scopeStore, (s) => s.picked);
  const profiles = useProfiles();
  const spaceId = useHarnessSelector((s) => s.spaceId);
  if (chosen === ALL_PROFILES)
    return {
      id: ALL_PROFILES,
      profile: null,
      installTo: profiles.map((p) => p.id),
    };
  // A picked profile that was since removed falls back to the one you're in.
  const profile =
    profiles.find((p) => p.id === chosen) ??
    profiles.find((p) => p.id === spaceId) ??
    profiles[0];
  return { id: profile.id, profile, installTo: [profile.id] };
}
