import { luminance, over, parseHex } from './color.ts';
import { themeTokens } from './map.ts';
import { kindOf, THEME_VARIABLE_GROUPS, THEME_VARIABLES, type ColorTheme, type ThemeKind, type VsCodeTheme } from './model.ts';
import { parseTheme } from './vsix.ts';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

/** A custom theme file as the theme list shows it. Throws when the text isn't a valid theme. */
export function customTheme(file: string, text: string): ColorTheme {
  const theme = parseTheme(text);
  return { id: `custom:${file}`, label: theme.name || file.replace(/\.jsonc?$/i, ''), kind: customKind(theme), source: { kind: 'custom', file }, theme };
}

/** The theme's own `type`, else light when its editor background is light. */
export function customKind(theme: VsCodeTheme): ThemeKind {
  if (theme.type) return kindOf(undefined, theme.type);
  const background = parseHex(theme.colors['editor.background']);
  return background && luminance(over(background, WHITE)) > 0.4 ? 'light' : 'dark';
}

/** A file name for a new custom theme: its name in kebab case, unique among `taken`. */
export function customFileName(name: string | undefined, taken: string[]) {
  const base = (name ?? 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'theme';
  let file = `${base}.json`;
  for (let n = 2; taken.includes(file); n++) file = `${base}-${n}.json`;
  return file;
}

/** A custom theme file name the renderer sent, checked before it touches a path. */
export function checkCustomFile(file: unknown) {
  if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}\.jsonc?$/i.test(file)) throw new TypeError('file is not a custom theme file name');
  return file;
}

/** The JSON schema written beside the custom theme files, which they name in `$schema` for completion and color pickers. */
export const SCHEMA_FILE = 'mochi-theme.schema.json';

const HEX = '^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';

const TYPES = { light: 'light', dark: 'dark', 'hc-light': 'hcLight', 'hc-dark': 'hc' } satisfies Record<ThemeKind, string>;

export function themeSchema() {
  const groupOf = (name: string) => Object.entries(THEME_VARIABLE_GROUPS).find(([, names]) => (names as readonly string[]).includes(name))![0];
  const variables = Object.fromEntries(THEME_VARIABLES.map((name) => [name, { type: 'string', format: 'color-hex', pattern: HEX, description: `${groupOf(name)}: Mochi's --${name}` }]));
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Mochi color theme',
    description: 'A VS Code color theme plus an optional `mochi` block that sets Mochi\'s own variables directly.',
    type: 'object',
    properties: {
      $schema: { type: 'string' },
      name: { type: 'string' },
      type: { enum: Object.values(TYPES), description: 'Which appearance the theme is for; high contrast fills the light or dark slot.' },
      mochi: {
        type: 'object',
        description: "Mochi's variables as hex, applied over whatever `colors` maps to. Unset variables come from `colors`; status and diff colors stay Mochi's unless set here (diff also from the theme's gitDecoration keys).",
        properties: variables,
        additionalProperties: false,
      },
      colors: { type: 'object', description: 'VS Code workbench colors, mapped onto Mochi as DESIGN.md › Color themes lists.', additionalProperties: { type: 'string', format: 'color-hex' } },
      tokenColors: { type: 'array', description: 'TextMate rules for code in diffs, code blocks and the file viewer.', items: { type: 'object' } },
      semanticTokenColors: { type: 'object' },
      semanticHighlighting: { type: 'boolean' },
    },
  };
}

/** `theme` as a new custom theme file's text, its `mochi` block filled with every variable it maps to, ready to edit. */
export function customizedThemeText(theme: ColorTheme) {
  const tokens = themeTokens(theme.theme, theme.kind);
  const mochi = Object.fromEntries(THEME_VARIABLES.flatMap((name) => (tokens[`--${name}`] ? [[name, tokens[`--${name}`]]] : [])));
  const { name: _, type: __, mochi: ___, ...rest } = theme.theme;
  return themeFileText({ name: `${theme.label} (custom)`, type: TYPES[theme.kind], mochi, ...rest });
}

/** A theme as a custom file writes it: pointing at the schema beside it, `mochi` before the long VS Code blocks. */
export const themeFileText = (theme: VsCodeTheme) => JSON.stringify({ $schema: `./${SCHEMA_FILE}`, ...theme }, null, 2);
