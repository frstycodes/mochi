import { AA, contrast, lightness, mix, nudge, over, parseHex, toHex, withAlpha, withLightness, type Rgba } from './color.ts';
import { slotOf, THEME_VARIABLES, type ThemeKind, type ThemeSlot, type TokenColor, type VsCodeTheme } from './model.ts';

/**
 * VS Code `colors` keys each Mochi token reads, first present wins (DESIGN.md › Color themes has this table). A token whose
 * keys are all missing is derived from `editor.background` / `editor.foreground` in `themeTokens`. Status colors
 * (`destructive`, `warning`, `success`, `info`, `merged`) are absent on purpose: they mean PR and run states, so only a
 * theme's own `mochi` block moves them.
 */
export const TOKEN_SOURCES = {
  '--background': ['editor.background'],
  '--foreground': ['editor.foreground', 'foreground'],
  '--sidebar': ['sideBar.background', 'activityBar.background'],
  '--card': ['editorWidget.background', 'sideBarSectionHeader.background'],
  '--popover': ['editorHoverWidget.background', 'menu.background', 'quickInput.background', 'editorWidget.background'],
  '--popover-foreground': ['editorHoverWidget.foreground', 'menu.foreground', 'editor.foreground'],
  '--primary': ['button.background'],
  '--primary-foreground': ['button.foreground'],
  '--secondary': ['button.secondaryBackground'],
  '--secondary-foreground': ['button.secondaryForeground'],
  '--muted': ['input.background'],
  '--muted-foreground': ['descriptionForeground'],
  '--accent': ['list.hoverBackground', 'list.inactiveSelectionBackground'],
  '--accent-foreground': ['list.hoverForeground'],
  '--border': ['panel.border', 'sideBar.border', 'editorGroup.border', 'contrastBorder'],
  '--input': ['input.border', 'dropdown.border', 'contrastBorder'],
  '--ring': ['focusBorder'],
  '--highlight': ['editor.lineHighlightBackground'],
  '--sidebar-accent': ['list.inactiveSelectionBackground', 'list.hoverBackground'],
  '--chart-1': ['terminal.ansiBlue'],
  '--chart-3': ['terminal.ansiCyan'],
  '--chart-4': ['terminal.ansiYellow'],
  '--chart-5': ['terminal.ansiMagenta'],
} as const satisfies Record<`--${string}`, readonly string[]>;

// VS Code's own terminal ANSI defaults, for chart lines of themes that leave them out.
const ANSI = {
  dark: { red: '#f14c4c', green: '#23d18b', yellow: '#f5f543', blue: '#3b8eea', magenta: '#d670d6', cyan: '#29b8db' },
  light: { red: '#cd3131', green: '#00bc00', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc' },
} as const;

// Highlight rows (`bg-accent`) must sit this far in lightness from the popover, or a menu's active item vanishes.
const MIN_ACCENT_STEP = 0.04;
// Hairlines and field edges a theme draws in its own surface color (One Dark Pro's `input.border` is its widget
// background) fall back to translucent foreground. Mochi's own border measures about 1.2:1.
const MIN_BORDER = 1.15;
const MIN_INPUT = 1.3;

/**
 * Every Mochi CSS token a VS Code theme sets, as hex. Text pairs are nudged to 4.5:1 against the surfaces they sit on; the
 * theme's `mochi` block is applied on top as written, then the translucent tokens derive from the result.
 */
export function themeTokens(theme: VsCodeTheme, kind: ThemeKind): Record<string, string> {
  const isDark = slotOf(kind) === 'dark';
  const ansi = ANSI[isDark ? 'dark' : 'light'];
  const read = (keys: readonly string[]) => keys.map((k) => parseHex(theme.colors[k])).find((c) => !!c && c.a > 0) ?? null;
  const pick = (token: keyof typeof TOKEN_SOURCES) => read(TOKEN_SOURCES[token]);

  const background = opaque(pick('--background'), parseHex(isDark ? '#1e1e1e' : '#ffffff')!);
  const foreground0 = pick('--foreground') ?? parseHex(isDark ? '#d4d4d4' : '#333333')!;
  const surface = (token: keyof typeof TOKEN_SOURCES, fallback: Rgba) => opaque(pick(token), background, fallback);

  const sidebar = surface('--sidebar', background);
  const card = surface('--card', mix(background, foreground0, 0.04));
  const popover = surface('--popover', card);
  const muted = surface('--muted', mix(background, foreground0, 0.06));
  const secondary = surface('--secondary', mix(background, foreground0, 0.08));
  const primary = surface('--primary', foreground0);
  const accent = apart(over(pick('--accent') ?? withAlpha(foreground0, 0.08), popover), popover);
  const canvases = [background, sidebar, card, popover];

  const foreground = nudge(foreground0, canvases);
  const chart = (color: Rgba) => nudge(color, [background], 3);
  const ansiColor = (key: string, fallback: string) => parseHex(theme.colors[key]) ?? parseHex(fallback)!;
  const diff = (side: keyof typeof DIFF_SOURCES) => {
    const color = read(DIFF_SOURCES[side]);
    return color ? { [`--diff-${side}`]: nudge(opaque(color, background), [...canvases, muted]) } : {};
  };

  const mapped = {
    '--background': background,
    '--foreground': foreground,
    '--card': card,
    '--popover': popover,
    '--popover-foreground': nudge(pick('--popover-foreground') ?? foreground, [popover]),
    '--primary': primary,
    '--primary-foreground': nudge(pick('--primary-foreground') ?? background, [primary]),
    '--secondary': secondary,
    '--secondary-foreground': nudge(pick('--secondary-foreground') ?? foreground, [secondary]),
    '--muted': muted,
    '--muted-foreground': nudge(pick('--muted-foreground') ?? mix(foreground, background, 0.3), [...canvases, muted]),
    '--subtle-foreground': nudge(mix(foreground, background, 0.42), canvases),
    '--accent': accent,
    '--accent-foreground': nudge(pick('--accent-foreground') ?? foreground, [accent]),
    '--border': visible(pick('--border'), [background, card], MIN_BORDER) ?? withAlpha(foreground, 0.1),
    '--input': visible(pick('--input'), [background, card], MIN_INPUT) ?? withAlpha(foreground, 0.15),
    '--ring': nudge(opaque(pick('--ring'), background, mix(foreground, background, 0.3)), [background, card], 3),
    '--highlight': pick('--highlight') ?? withAlpha(foreground, 0.06),
    '--sidebar': sidebar,
    '--sidebar-accent': pick('--sidebar-accent') ?? withAlpha(foreground, 0.07),
    '--chart-1': chart(ansiColor('terminal.ansiBlue', ansi.blue)),
    // Mochi's second line color is orange, which ANSI lacks: halfway between its red and yellow.
    '--chart-2': chart(mix(ansiColor('terminal.ansiRed', ansi.red), ansiColor('terminal.ansiYellow', ansi.yellow), 0.5)),
    '--chart-3': chart(ansiColor('terminal.ansiCyan', ansi.cyan)),
    '--chart-4': chart(ansiColor('terminal.ansiYellow', ansi.yellow)),
    '--chart-5': chart(ansiColor('terminal.ansiMagenta', ansi.magenta)),
    ...diff('added'),
    ...diff('removed'),
  } satisfies Record<`--${string}`, Rgba>;
  const own = { ...mapped, ...syntaxTokens(theme.tokenColors), ...ownTokens(theme) };
  const derived = {
    '--chart-grid': withAlpha(own['--foreground'], 0.07),
    '--chart-axis': withAlpha(own['--foreground'], 0.18),
    '--float': withAlpha(own['--popover'], 0.9),
    '--glass': withAlpha(own['--popover'], isDark ? 0.55 : 0.62),
    '--glass-edge': withAlpha(own['--foreground'], 0.1),
    '--scrim': withAlpha(own['--background'], 0.72),
  } satisfies Record<`--${string}`, Rgba>;
  return Object.fromEntries(Object.entries({ ...own, ...derived }).map(([k, v]) => [k, toHex(v)]));
}

/**
 * The VS Code keys that count as a theme's own diff colors, first present wins. A theme with none keeps Mochi's diff colors
 * (`--diff-*` fall back to `success` / `destructive` in index.css); ANSI green and red are not diff colors.
 */
export const DIFF_SOURCES = {
  added: ['gitDecoration.addedResourceForeground', 'editorGutter.addedBackground'],
  removed: ['gitDecoration.deletedResourceForeground', 'editorGutter.deletedBackground'],
  modified: ['gitDecoration.modifiedResourceForeground', 'editorGutter.modifiedBackground'],
} as const satisfies Record<string, readonly string[]>;

// pierre-dark / pierre-light's own git colors (@pierre/theme), which Mochi's diffs show.
const MOCHI_DIFF = {
  dark: { added: '#07c480', removed: '#ff2e3f', modified: '#009fff' },
  light: { added: '#18a46c', removed: '#d52c36', modified: '#009fff' },
} as const satisfies Record<ThemeSlot, Record<keyof typeof DIFF_SOURCES, string>>;

const PIERRE_KEYS = {
  added: 'gitDecoration.addedResourceForeground',
  removed: 'gitDecoration.deletedResourceForeground',
  modified: 'gitDecoration.modifiedResourceForeground',
} as const satisfies Record<keyof typeof DIFF_SOURCES, string>;

/**
 * The git keys pierre reads for diff colors, always set: pierre falls back to `terminal.ansiGreen` / `ansiRed` when they're
 * missing, which would recolor diffs for every theme with a terminal palette. Order: `mochi` block, the theme's own diff
 * keys, Mochi's.
 */
export function pierreDiffColors({ colors, mochi }: VsCodeTheme, slot: ThemeSlot) {
  const color = (side: keyof typeof DIFF_SOURCES) => mochi?.[`diff-${side}`] ?? DIFF_SOURCES[side].map((k) => colors[k]).find((c) => !!c) ?? MOCHI_DIFF[slot][side];
  return Object.fromEntries(Object.entries(PIERRE_KEYS).map(([side, key]) => [key, color(side as keyof typeof DIFF_SOURCES)]));
}

/** A theme's `mochi` block as tokens: only known variables with a valid hex value, taken as written (no contrast nudge). */
function ownTokens(theme: VsCodeTheme): Record<string, Rgba> {
  const entries = Object.entries(theme.mochi ?? {}).flatMap(([name, value]) => {
    const color = parseHex(value);
    return color && (THEME_VARIABLES as readonly string[]).includes(name) ? [[`--${name}`, color]] : [];
  });
  return Object.fromEntries(entries);
}

/** A theme color painted over `base` (themes often give surfaces as translucent overlays), or `fallback`. */
function opaque(color: Rgba | null, base: Rgba, fallback: Rgba = base) {
  return color ? over(color, base) : fallback;
}

/** `color` when it shows against every surface at `ratio` or more, painted over each; else null. */
function visible(color: Rgba | null, surfaces: Rgba[], ratio: number) {
  return color && surfaces.every((s) => contrast(over(color, s), s) >= ratio) ? color : null;
}

function apart(accent: Rgba, popover: Rgba) {
  const step = lightness(accent) - lightness(popover);
  if (Math.abs(step) >= MIN_ACCENT_STEP) return accent;
  const up = lightness(popover) < 0.5;
  return withLightness(accent, lightness(popover) + (up ? 1 : -1) * (MIN_ACCENT_STEP + 0.02));
}

/** The CodeMirror file viewer's colors (`src/files/CodeEditor.tsx`), each from the first TextMate scope the theme colors. */
export const SYNTAX_SCOPES = {
  '--syntax-keyword': ['keyword.control', 'keyword', 'storage.type'],
  '--syntax-string': ['string'],
  '--syntax-comment': ['comment'],
  '--syntax-number': ['constant.numeric', 'constant.language', 'constant'],
  '--syntax-function': ['entity.name.function', 'support.function'],
  '--syntax-type': ['entity.name.type', 'support.type', 'entity.name.class'],
  '--syntax-tag': ['entity.name.tag'],
  '--syntax-property': ['variable.other.property', 'support.type.property-name', 'meta.object-literal.key'],
  '--syntax-link': ['markup.underline.link', 'string.other.link'],
} as const satisfies Record<`--${string}`, readonly string[]>;

function syntaxTokens(tokenColors: TokenColor[]): Record<string, Rgba> {
  const entries = Object.entries(SYNTAX_SCOPES).flatMap(([token, scopes]) => {
    const color = scopes.map((s) => parseHex(scopeColor(tokenColors, s))).find((c) => !!c);
    return color ? [[token, color]] : [];
  });
  return Object.fromEntries(entries);
}

/**
 * The foreground TextMate gives `scope`: the rule whose selector is the longest dot-prefix of it, the later rule on a tie.
 * Descendant selectors (`meta.class entity.name`) match on their last part only.
 */
export function scopeColor(tokenColors: TokenColor[], scope: string): string | undefined {
  let best: { depth: number; color: string } | undefined;
  for (const rule of tokenColors) {
    const color = rule.settings?.foreground;
    if (!rule.scope || !parseHex(color)) continue;
    const selectors = Array.isArray(rule.scope) ? rule.scope : rule.scope.split(',');
    for (const selector of selectors) {
      const last = selector.trim().split(/\s+/).pop() ?? '';
      if (!last || (scope !== last && !scope.startsWith(`${last}.`))) continue;
      const depth = last.split('.').length;
      if (!best || depth >= best.depth) best = { depth, color: color! };
    }
  }
  return best?.color;
}

/** Whether `text` reads at AA on `surface`, both as hex; for tests and the preview swatch. */
export const readsOn = (text: string, surface: string) => contrast(parseHex(text)!, parseHex(surface)!) >= AA;
