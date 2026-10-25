import { persistedSlice } from './lib/uiStorage.ts';
import { useSyncExternalStore } from 'react';
import { showsDemoData } from './demoData.ts';
import {
  DEFAULT_SPACES,
  SPACE_ICON_NAMES,
  type Space,
  type SpaceIconName,
} from './model.ts';
import { setAmbientProfiles } from './store/context.ts';
import type { Replica } from './store/replica.ts';

/**
 * Profiles (spaces), edited in Settings › Profiles. Everything that lists or names a space reads them here. A profile's id
 * keys its threads, layout, account links and browser session (`persist:space-<id>`), so it never changes once made. Core
 * holds them in the store's `context` (src/store/context.ts); this reads the window's replica of it and writes through it.
 */
export const PROFILES_KEY = 'mochi.profiles.v1';
// ⌥1 … ⌥9 switch profiles, and the sidebar pages through them; past nine neither reaches the rest.
export const MAX_PROFILES = 9;

/** A desktop install without demo data starts with this one profile. */
export const FIRST_PROFILE: Space = {
  id: 'personal',
  name: 'Personal',
  icon: 'home',
  plans: { claude: '', codex: '' },
  github: '',
};

/** The window's replica (`startStore`), set before the first render. */
let replica: Pick<Replica, 'store' | 'getState' | 'dispatch'> | undefined;
let read: { saved: Space[] | undefined; list: Space[] } | undefined;
const storedSlice = () =>
  persistedSlice(PROFILES_KEY, startingProfiles(), parseProfiles);
let slice: ReturnType<typeof storedSlice> | undefined;

export function followProfiles(next: NonNullable<typeof replica>) {
  replica = next;
  read = undefined;
}

/** Core's profiles, or the starting ones until a window migrated its own; the same list until they change. */
export function getProfiles(): Space[] {
  const saved = replica?.store.getState().context.profiles;
  if (!read || read.saved !== saved)
    read = { saved, list: withDemo(saved ?? startingProfiles()) };
  return read.list;
}

export function useProfiles(): Space[] {
  return useSyncExternalStore(subscribe, getProfiles, getProfiles);
}

/** The profile, or the first one when it was removed in another window. */
export function profileById(id: string): Space {
  const profiles = getProfiles();
  return profiles.find((p) => p.id === id) ?? profiles[0];
}

/** What this window keeps in its storage: the migration's input the first time Core has none (src/store/index.tsx). */
export function storedProfiles(): Space[] {
  return storedSlice().getState().value;
}

/** A new profile, empty or with `from`'s own settings (GitHub login, what it turns off natively); a new id and icon either way. */
export function addProfile(name: string, from?: Space): Space {
  const profiles = getProfiles();
  if (profiles.length >= MAX_PROFILES)
    throw new Error(`Mochi holds up to ${MAX_PROFILES} profiles`);
  const profile: Space = {
    plans: { claude: '', codex: '' },
    github: '',
    ...(from && {
      plans: from.plans,
      github: from.github,
      nativeOff: from.nativeOff,
      nativeNew: from.nativeNew,
    }),
    id: newProfileId(
      name,
      profiles.map((p) => p.id),
    ),
    name,
    icon:
      SPACE_ICON_NAMES.find((icon) => !profiles.some((p) => p.icon === icon)) ??
      'layers',
  };
  write([...profiles, profile]);
  return profile;
}

export function updateProfile(
  id: string,
  patch: Partial<
    Pick<Space, 'name' | 'icon' | 'github' | 'nativeOff' | 'nativeNew'>
  >,
) {
  write(getProfiles().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/** Callers check the profile has no threads first; the last profile always stays. Returns an undo that puts it back in place. */
export function removeProfile(id: string) {
  const profiles = getProfiles();
  if (profiles.length === 1) throw new Error('Keep at least one profile');
  const index = profiles.findIndex((p) => p.id === id);
  const removed = profiles[index];
  write(profiles.filter((p) => p.id !== id));
  return () => {
    const now = getProfiles();
    if (now.some((p) => p.id === id) || now.length >= MAX_PROFILES) return;
    write(now.toSpliced(Math.min(index, now.length), 0, removed));
  };
}

/** Lowercase letters, digits and dashes (the browser session name allows nothing else), unique among `taken`. */
export function newProfileId(name: string, taken: string[]) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'profile';
  let id = slug;
  for (let n = 2; taken.includes(id); n++) id = `${slug}-${n}`;
  return id;
}

/** Saved profiles when they parse into at least one valid entry, else the starting ones: the demo's, or one empty profile on desktop. */
export function parseProfiles(
  raw: string | null,
  fallback = startingProfiles(),
): Space[] {
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

function write(profiles: Space[]) {
  if (!replica) throw new Error('Profiles change only once the store started');
  const { context } = replica.getState();
  replica.dispatch({ type: 'context', context: { ...context, profiles } });
  // Also kept here: without Core (the web build) the page's log starts empty each load, and this is what it migrates.
  (slice ??= storedSlice()).setState({ value: profiles });
}

// Demo threads live in the demo's profiles, so with demo data on any you don't have join the list (unsaved; they hold threads, so can't be removed).
function withDemo(list: Space[]) {
  if (!showsDemoData()) return list;
  return [
    ...list,
    ...DEFAULT_SPACES.filter((d) => !list.some((p) => p.id === d.id)),
  ].slice(0, MAX_PROFILES);
}

function subscribe(listener: () => void) {
  return replica?.store.subscribe(listener) ?? (() => {});
}

setAmbientProfiles(getProfiles);
