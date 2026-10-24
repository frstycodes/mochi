import type { ThemeRegistration } from '@pierre/diffs';
import { slotOf, type ColorTheme } from './model';

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

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const shikiThemes = new WeakMap<ColorTheme, ThemeRegistration>();
