import { persistedSlice } from '../lib/uiStorage.ts';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { host } from '../host';
import {
  getPrefs,
  setPrefs,
  subscribePrefs,
  usePrefs,
} from '../settings/prefs';
import {
  MOCHI_THEME_ID,
  slotOf,
  type ColorTheme,
  type ThemeSlot,
} from './model';

// The chosen themes themselves, so a launch paints them before main has listed what's installed.
const activeSlice = persistedSlice<State['active']>(
  'mochi.themes.active.v1',
  {},
);

interface State {
  installed: ColorTheme[];
  isLoaded: boolean;
  /** The theme the pointer rests on in Settings › Appearance, shown until it leaves. */
  preview: ColorTheme | null;
  active: Partial<Record<ThemeSlot, ColorTheme>>;
}

let state: State = {
  installed: [],
  isLoaded: false,
  preview: null,
  active: activeSlice.getState().value,
};
const listeners = new Set<() => void>();

function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useThemesState() {
  return useSyncExternalStore(subscribe, () => state);
}

export async function refreshThemes() {
  await queryClient.fetchQuery({
    queryKey: queryKeys.themes.installed(),
    queryFn: readThemes,
    staleTime: 0,
  });
}

export async function readThemes() {
  const installed = await host.themes.list();
  update({ installed, isLoaded: true });
  syncActive();
  return installed;
}

export function setThemePreview(preview: ColorTheme | null) {
  if (state.preview !== preview) update({ preview });
}

/** Uses `theme` (null = Mochi) for its own appearance, light or dark. */
export function chooseTheme(theme: ColorTheme | null, slot: ThemeSlot) {
  setPrefs(
    slot === 'light'
      ? { lightTheme: theme?.id ?? MOCHI_THEME_ID }
      : { darkTheme: theme?.id ?? MOCHI_THEME_ID },
  );
}

/** The theme a slot shows: an installed one by id, else the cached copy while the list loads, else Mochi (null). */
function themeFor(
  id: string,
  slot: ThemeSlot,
  { installed, isLoaded, active }: State,
) {
  if (id === MOCHI_THEME_ID) return null;
  return (
    installed.find((t) => t.id === id) ??
    (isLoaded ? null : active[slot]?.id === id ? active[slot] : null) ??
    null
  );
}

/**
 * The appearance on screen: `mode` follows Light / Dark / System, or the previewed theme's own kind while one is previewed;
 * `light` / `dark` are each slot's theme (null = Mochi), the preview standing in for its slot.
 */
export function useColorTheme() {
  const { resolvedTheme } = useTheme();
  const prefs = usePrefs();
  const current = useThemesState();
  const previewSlot = current.preview && slotOf(current.preview.kind);
  const mode: ThemeSlot =
    previewSlot ?? (resolvedTheme === 'light' ? 'light' : 'dark');
  const light =
    previewSlot === 'light'
      ? current.preview
      : themeFor(prefs.lightTheme, 'light', current);
  const dark =
    previewSlot === 'dark'
      ? current.preview
      : themeFor(prefs.darkTheme, 'dark', current);
  return {
    mode,
    light,
    dark,
    theme: mode === 'light' ? light : dark,
    isPreview: !!previewSlot,
  };
}

function syncActive() {
  const prefs = getPrefs();
  const light = themeFor(prefs.lightTheme, 'light', state) ?? undefined;
  const dark = themeFor(prefs.darkTheme, 'dark', state) ?? undefined;
  if (state.active.light === light && state.active.dark === dark) return;
  update({ active: { light, dark } });
  activeSlice.setState({ value: { light, dark } });
}

if (typeof window !== 'undefined') subscribePrefs(syncActive);
