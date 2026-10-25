import { luminance, over, parseHex } from './color.ts';
import {
  kindOf,
  type ColorTheme,
  type ThemeKind,
  type VsCodeTheme,
} from './model.ts';
import { parseTheme } from './vsix.ts';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

/** A custom theme file as the theme list shows it. Throws when the text isn't a valid theme. */
export function customTheme(file: string, text: string): ColorTheme {
  const theme = parseTheme(text);
  return {
    id: `custom:${file}`,
    label: theme.name || file.replace(/\.jsonc?$/i, ''),
    kind: customKind(theme),
    source: { kind: 'custom', file },
    theme,
  };
}

/** The theme's own `type`, else light when its editor background is light. */
export function customKind(theme: VsCodeTheme): ThemeKind {
  if (theme.type) return kindOf(undefined, theme.type);
  const background = parseHex(theme.colors['editor.background']);
  return background && luminance(over(background, WHITE)) > 0.4
    ? 'light'
    : 'dark';
}

/** A file name for a new custom theme: its name in kebab case, unique among `taken`. */
export function customFileName(name: string | undefined, taken: string[]) {
  const base =
    (name ?? 'theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'theme';
  let file = `${base}.json`;
  for (let n = 2; taken.includes(file); n++) file = `${base}-${n}.json`;
  return file;
}

/** A custom theme file name the renderer sent, checked before it touches a path. */
export function checkCustomFile(file: unknown) {
  if (
    typeof file !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}\.jsonc?$/i.test(file)
  )
    throw new TypeError('file is not a custom theme file name');
  return file;
}
