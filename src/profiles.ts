import { useSyncExternalStore } from 'react';
import { showsDemoData } from './demoData.ts';
import { DEFAULT_SPACES, SPACE_ICON_NAMES, type Space, type SpaceIconName } from './model.ts';

/**
 * Profiles (spaces), edited in Settings › Profiles. Everything that lists or names a space reads them here. A profile's id
 * keys its threads, layout, account links and browser session (`persist:space-<id>`), so it never changes once made.
 */
export const PROFILES_KEY = 'mochi.profiles.v1';
// ⌥1 … ⌥9 switch profiles, and the sidebar pages through them; past nine neither reaches the rest.
export const MAX_PROFILES = 9;

/** A desktop install without demo data starts with this one profile. */
export const FIRST_PROFILE: Space = { id: 'personal', name: 'Personal', icon: 'home', plans: { claude: '', codex: '' }, github: '' };

let profiles = load();
const listeners = new Set<() => void>();

export function getProfiles(): Space[] {
  return profiles;
}

export function useProfiles(): Space[] {
  return useSyncExternalStore(subscribe, getProfiles, getProfiles);
}

/** The profile, or the first one when it was removed in another window. */
export function profileById(id: string): Space {
  return profiles.find((p) => p.id === id) ?? profiles[0];
}

export function addProfile(name: string): Space {
  if (profiles.length >= MAX_PROFILES) throw new Error(`Mochi holds up to ${MAX_PROFILES} profiles`);
  const profile: Space = {
    id: newProfileId(name, profiles.map((p) => p.id)),
    name,
    icon: SPACE_ICON_NAMES.find((icon) => !profiles.some((p) => p.icon === icon)) ?? 'layers',
    plans: { claude: '', codex: '' },
    github: '',
  };
  write([...profiles, profile]);
  return profile;
}

export function updateProfile(id: string, patch: Partial<Pick<Space, 'name' | 'icon' | 'github' | 'syncInstructions' | 'nativeOff' | 'nativeNew'>>) {
  write(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/** Callers check the profile has no threads first; the last profile always stays. Returns an undo that puts it back in place. */
export function removeProfile(id: string) {
  if (profiles.length === 1) throw new Error('Keep at least one profile');
  const index = profiles.findIndex((p) => p.id === id);
  const removed = profiles[index];
  write(profiles.filter((p) => p.id !== id));
  return () => {
    if (profiles.some((p) => p.id === id) || profiles.length >= MAX_PROFILES) return;
    write(profiles.toSpliced(Math.min(index, profiles.length), 0, removed));
  };
}

/** Lowercase letters, digits and dashes (the browser session name allows nothing else), unique among `taken`. */
export function newProfileId(name: string, taken: string[]) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'profile';
  let id = slug;
  for (let n = 2; taken.includes(id); n++) id = `${slug}-${n}`;
  return id;
}

/** Saved profiles when they parse into at least one valid entry, else the starting ones: the demo's, or one empty profile on desktop. */
export function parseProfiles(raw: string | null, fallback = startingProfiles()): Space[] {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null');
    if (!Array.isArray(saved)) return fallback;
    const valid = saved.filter(isProfile).slice(0, MAX_PROFILES);
    return valid.length ? valid : fallback;
  } catch {
    return fallback;
  }
}

function startingProfiles() {
  return showsDemoData() ? DEFAULT_SPACES : [FIRST_PROFILE];
}

function isProfile(value: unknown): value is Space {
  const p = value as Space;
  return (
    !!p &&
    typeof p.id === 'string' &&
    /^[a-z0-9-]+$/.test(p.id) &&
    typeof p.name === 'string' &&
    SPACE_ICON_NAMES.includes(p.icon as SpaceIconName) &&
    typeof p.github === 'string' &&
    typeof p.plans?.claude === 'string' &&
    typeof p.plans?.codex === 'string'
  );
}

function write(next: Space[]) {
  profiles = next;
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // Storage blocked (private window, artifact sandbox): edits last for this session.
  }
  listeners.forEach((l) => l());
}

function load() {
  let list: Space[];
  try {
    list = parseProfiles(localStorage.getItem(PROFILES_KEY));
  } catch {
    list = startingProfiles();
  }
  // Demo threads live in the demo's profiles, so with demo data on any you don't have join the list (unsaved; they hold threads, so can't be removed).
  if (!showsDemoData()) return list;
  return [...list, ...DEFAULT_SPACES.filter((d) => !list.some((p) => p.id === d.id))].slice(0, MAX_PROFILES);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== PROFILES_KEY) return;
    profiles = load();
    listeners.forEach((l) => l());
  });
