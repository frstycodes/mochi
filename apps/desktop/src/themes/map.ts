import {
  AA,
  contrast,
  lightness,
  mix,
  nudge,
  over,
  parseHex,
  toHex,
  withAlpha,
  withLightness,
  type Rgba,
} from '@mochi/domain/themes/color';
import {
  slotOf,
  type ThemeKind,
  type TokenColor,
  type VsCodeTheme,
} from '@mochi/domain/themes/model';

/**
 * VS Code `colors` keys each Mochi token reads, first present wins (DESIGN.md › Color themes has this table). A token whose
 * keys are all missing is derived from `editor.background` / `editor.foreground` in `themeTokens`.
 */
export const TOKEN_SOURCES = {
  '--background': ['editor.background'],
  '--foreground': ['editor.foreground', 'foreground'],
  '--sidebar': ['sideBar.background', 'activityBar.background'],
  '--card': ['editorWidget.background', 'sideBarSectionHeader.background'],
  '--popover': [
    'editorHoverWidget.background',
    'menu.background',
    'quickInput.background',
    'editorWidget.background',
  ],
  '--popover-foreground': [
    'editorHoverWidget.foreground',
    'menu.foreground',
    'editor.foreground',
  ],
  '--primary': ['button.background'],
  '--primary-foreground': ['button.foreground'],
  '--secondary': ['button.secondaryBackground'],
  '--secondary-foreground': ['button.secondaryForeground'],
  '--muted': ['input.background'],
  '--muted-foreground': ['descriptionForeground'],
  '--accent': ['list.hoverBackground', 'list.inactiveSelectionBackground'],
  '--accent-foreground': ['list.hoverForeground'],
  '--destructive': [
    'errorForeground',
    'editorError.foreground',
    'terminal.ansiRed',
  ],
  '--warning': ['editorWarning.foreground', 'terminal.ansiYellow'],
  '--success': ['terminal.ansiGreen', 'gitDecoration.addedResourceForeground'],
  '--info': [
    'textLink.foreground',
    'editorInfo.foreground',
    'terminal.ansiBlue',
  ],
  '--merged': ['terminal.ansiMagenta'],
  '--border': [
    'panel.border',
    'sideBar.border',
    'editorGroup.border',
    'contrastBorder',
  ],
  '--input': ['input.border', 'dropdown.border', 'contrastBorder'],
  '--ring': ['focusBorder'],
  '--highlight': ['editor.lineHighlightBackground'],
  '--sidebar-accent': [
    'list.inactiveSelectionBackground',
    'list.hoverBackground',
  ],
  '--chart-1': ['terminal.ansiBlue'],
  '--chart-3': ['terminal.ansiCyan'],
  '--chart-4': ['terminal.ansiYellow'],
  '--chart-5': ['terminal.ansiMagenta'],
} as const satisfies Record<`--${string}`, readonly string[]>;

// VS Code's own terminal ANSI defaults, for themes that leave them out. Status text is nudged to AA after.
const ANSI = {
  dark: {
    red: '#f14c4c',
    green: '#23d18b',
    yellow: '#f5f543',
    blue: '#3b8eea',
    magenta: '#d670d6',
    cyan: '#29b8db',
  },
  light: {
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
  },
} as const;

// Highlight rows (`bg-accent`) must sit this far in lightness from the popover, or a menu's active item vanishes.
const MIN_ACCENT_STEP = 0.04;
// Hairlines and field edges a theme draws in its own surface color (One Dark Pro's `input.border` is its widget
// background) fall back to translucent foreground. Mochi's own border measures about 1.2:1.
const MIN_BORDER = 1.15;
const MIN_INPUT = 1.3;

/** Every Mochi CSS token a VS Code theme sets, as hex. Text pairs are nudged to 4.5:1 against the surfaces they sit on. */
export function themeTokens(
  theme: VsCodeTheme,
  kind: ThemeKind,
): Record<string, string> {
  const isDark = slotOf(kind) === 'dark';
  const ansi = ANSI[isDark ? 'dark' : 'light'];
  const read = (keys: readonly string[]) =>
    keys.map((k) => parseHex(theme.colors[k])).find((c) => !!c && c.a > 0) ??
    null;
  const pick = (token: keyof typeof TOKEN_SOURCES) =>
    read(TOKEN_SOURCES[token]);

  const background = opaque(
    pick('--background'),
    parseHex(isDark ? '#1e1e1e' : '#ffffff')!,
  );
  const foreground0 =
    pick('--foreground') ?? parseHex(isDark ? '#d4d4d4' : '#333333')!;
  const surface = (token: keyof typeof TOKEN_SOURCES, fallback: Rgba) =>
    opaque(pick(token), background, fallback);

  const sidebar = surface('--sidebar', background);
  const card = surface('--card', mix(background, foreground0, 0.04));
  const popover = surface('--popover', card);
  const muted = surface('--muted', mix(background, foreground0, 0.06));
  const secondary = surface('--secondary', mix(background, foreground0, 0.08));
  const primary = surface('--primary', foreground0);
  const accent = apart(
    over(pick('--accent') ?? withAlpha(foreground0, 0.08), popover),
    popover,
  );
  const canvases = [background, sidebar, card, popover];

  const foreground = nudge(foreground0, canvases);
  const status = (token: keyof typeof TOKEN_SOURCES, fallback: string) =>
    nudge(pick(token) ?? parseHex(fallback)!, [...canvases, muted]);
  const chart = (color: Rgba) => nudge(color, [background], 3);
  const ansiColor = (key: string, fallback: string) =>
    parseHex(theme.colors[key]) ?? parseHex(fallback)!;

  const tokens = {
    '--background': background,
    '--foreground': foreground,
    '--card': card,
    '--popover': popover,
    '--popover-foreground': nudge(pick('--popover-foreground') ?? foreground, [
      popover,
    ]),
    '--primary': primary,
    '--primary-foreground': nudge(pick('--primary-foreground') ?? background, [
      primary,
    ]),
    '--secondary': secondary,
    '--secondary-foreground': nudge(
      pick('--secondary-foreground') ?? foreground,
      [secondary],
    ),
    '--muted': muted,
    '--muted-foreground': nudge(
      pick('--muted-foreground') ?? mix(foreground, background, 0.3),
      [...canvases, muted],
    ),
    '--subtle-foreground': nudge(mix(foreground, background, 0.42), canvases),
    '--accent': accent,
    '--accent-foreground': nudge(pick('--accent-foreground') ?? foreground, [
      accent,
    ]),
    '--destructive': status('--destructive', ansi.red),
    '--warning': status('--warning', ansi.yellow),
    '--success': status('--success', ansi.green),
    '--info': status('--info', ansi.blue),
    '--merged': status('--merged', ansi.magenta),
    '--border':
      visible(pick('--border'), [background, card], MIN_BORDER) ??
      withAlpha(foreground, 0.1),
    '--input':
      visible(pick('--input'), [background, card], MIN_INPUT) ??
      withAlpha(foreground, 0.15),
    '--ring': nudge(
      opaque(pick('--ring'), background, mix(foreground, background, 0.3)),
      [background, card],
      3,
    ),
    '--highlight': pick('--highlight') ?? withAlpha(foreground, 0.06),
    '--sidebar': sidebar,
    '--sidebar-accent': pick('--sidebar-accent') ?? withAlpha(foreground, 0.07),
    // A dot, not text: the theme's blue at full saturation, held to 3:1 on the sidebar it marks.
    '--unread': nudge(ansiColor('terminal.ansiBlue', ansi.blue), [sidebar], 3),
    '--chart-1': chart(ansiColor('terminal.ansiBlue', ansi.blue)),
    // Mochi's second line color is orange, which ANSI lacks: halfway between its red and yellow.
    '--chart-2': chart(
      mix(
        ansiColor('terminal.ansiRed', ansi.red),
        ansiColor('terminal.ansiYellow', ansi.yellow),
        0.5,
      ),
    ),
    '--chart-3': chart(ansiColor('terminal.ansiCyan', ansi.cyan)),
    '--chart-4': chart(ansiColor('terminal.ansiYellow', ansi.yellow)),
    '--chart-5': chart(ansiColor('terminal.ansiMagenta', ansi.magenta)),
    '--chart-grid': withAlpha(foreground, 0.07),
    '--chart-axis': withAlpha(foreground, 0.18),
    '--float': withAlpha(popover, 0.9),
    '--glass': withAlpha(popover, isDark ? 0.55 : 0.62),
    '--glass-edge': withAlpha(foreground, 0.1),
    '--scrim': withAlpha(background, 0.72),
  } satisfies Record<`--${string}`, Rgba>;
  return {
    ...Object.fromEntries(
      Object.entries(tokens).map(([k, v]) => [k, toHex(v)]),
    ),
    ...syntaxTokens(theme.tokenColors),
  };
}

/** A theme color painted over `base` (themes often give surfaces as translucent overlays), or `fallback`. */
function opaque(color: Rgba | null, base: Rgba, fallback: Rgba = base) {
  return color ? over(color, base) : fallback;
}

/** `color` when it shows against every surface at `ratio` or more, painted over each; else null. */
function visible(color: Rgba | null, surfaces: Rgba[], ratio: number) {
  return color && surfaces.every((s) => contrast(over(color, s), s) >= ratio)
    ? color
    : null;
}

function apart(accent: Rgba, popover: Rgba) {
  const step = lightness(accent) - lightness(popover);
  if (Math.abs(step) >= MIN_ACCENT_STEP) return accent;
  const up = lightness(popover) < 0.5;
  return withLightness(
    accent,
    lightness(popover) + (up ? 1 : -1) * (MIN_ACCENT_STEP + 0.02),
  );
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
  '--syntax-property': [
    'variable.other.property',
    'support.type.property-name',
    'meta.object-literal.key',
  ],
  '--syntax-link': ['markup.underline.link', 'string.other.link'],
} as const satisfies Record<`--${string}`, readonly string[]>;

function syntaxTokens(tokenColors: TokenColor[]) {
  const entries = Object.entries(SYNTAX_SCOPES).flatMap(([token, scopes]) => {
    const color = scopes
      .map((s) => scopeColor(tokenColors, s))
      .find((c) => !!c);
    return color ? [[token, color]] : [];
  });
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * The foreground TextMate gives `scope`: the rule whose selector is the longest dot-prefix of it, the later rule on a tie.
 * Descendant selectors (`meta.class entity.name`) match on their last part only.
 */
export function scopeColor(
  tokenColors: TokenColor[],
  scope: string,
): string | undefined {
  let best: { depth: number; color: string } | undefined;
  for (const rule of tokenColors) {
    const color = rule.settings?.foreground;
    if (!rule.scope || !parseHex(color)) continue;
    const selectors = Array.isArray(rule.scope)
      ? rule.scope
      : rule.scope.split(',');
    for (const selector of selectors) {
      const last = selector.trim().split(/\s+/).pop() ?? '';
      if (!last || (scope !== last && !scope.startsWith(`${last}.`))) continue;
      const depth = last.split('.').length;
      if (!best || depth >= best.depth) best = { depth, color: color! };
    }
  }
  return best?.color;
}

/** The chat code block's light surfaces (index.css): `--background`, and the ```diff add / remove line tints at its lightness. */
export const LIGHT_CODE_SURFACES = ['#f6f6f9', '#f0faf2', '#fff3f2'];

/**
 * `tokenColors` with each foreground nudged to AA on every surface, hue kept; colors that already read come back as written,
 * and so do rules that paint their own background.
 */
export function readableTokenColors(
  tokenColors: TokenColor[],
  surfaces: string[],
): TokenColor[] {
  const canvases = surfaces.map((s) => parseHex(s)!);
  return tokenColors.map((rule) => {
    const color =
      !rule.settings?.background && parseHex(rule.settings?.foreground);
    const readable = color && nudge(color, canvases);
    if (!readable || readable === color) return rule;
    return {
      ...rule,
      settings: { ...rule.settings, foreground: toHex(readable) },
    };
  });
}

/** Whether `text` reads at AA on `surface`, both as hex; for tests and the preview swatch. */
export const readsOn = (text: string, surface: string) =>
  contrast(parseHex(text)!, parseHex(surface)!) >= AA;
