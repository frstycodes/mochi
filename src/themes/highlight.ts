import { useMemo } from 'react';
import { DEFAULT_THEMES, registerCustomTheme, type ThemeRegistration } from '@pierre/diffs';
import { slotOf, type ColorTheme } from './model';
import { useColorTheme } from './store';

const shikiThemes = new WeakMap<ColorTheme, ThemeRegistration>();
const registered = new Set<string>();

/**
 * A color theme as shiki takes it. Named by a hash of its content: shiki and pierre cache by name, and a custom theme
 * edited on disk keeps its id.
 */
export function shikiTheme(theme: ColorTheme): ThemeRegistration {
  let shiki = shikiThemes.get(theme);
  if (!shiki) {
    const { colors, tokenColors, semanticTokenColors } = theme.theme;
    shiki = { name: `mochi-${hash(JSON.stringify(theme.theme))}`, type: slotOf(theme.kind), colors, tokenColors, semanticTokenColors } as ThemeRegistration;
    shikiThemes.set(theme, shiki);
  }
  return shiki;
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

/** Spread into a pierre diff's `options`: the color theme's token colors, in the mode on screen. */
export function useDiffTheme() {
  const { mode, light, dark } = useColorTheme();
  return useMemo(() => ({ themeType: mode, theme: { light: diffThemeName(light, 'light'), dark: diffThemeName(dark, 'dark') } }), [mode, light, dark]);
}

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
