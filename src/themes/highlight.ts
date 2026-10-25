import { DEFAULT_THEMES, registerCustomTheme } from '@pierre/diffs';
import type { ColorTheme } from './model';
import { shikiTheme } from './shiki';
import { useColorTheme } from './store';

/** Spread into a pierre diff's `options`: the color theme's token colors, in the mode on screen. */
export function useDiffTheme() {
  const { mode, light, dark } = useColorTheme();
  return { themeType: mode, theme: { light: diffThemeName(light, 'light'), dark: diffThemeName(dark, 'dark') } };
}

/** `theme` registered with pierre's highlighter by name; Mochi (null) keeps pierre's own themes. */
function diffThemeName(theme: ColorTheme | null, slot: 'light' | 'dark') {
  if (!theme) return DEFAULT_THEMES[slot];
  const shiki = shikiTheme(theme);
  if (!registered.has(shiki.name!)) {
    registerCustomTheme(shiki.name!, async () => shiki);
    registered.add(shiki.name!);
  }
  return shiki.name!;
}

const registered = new Set<string>();
