/** A VS Code color theme after its `include` chain is merged: what Mochi stores and maps. */
export interface VsCodeTheme {
  name?: string;
  type?: string;
  colors: Record<string, string>;
  tokenColors: TokenColor[];
  semanticTokenColors?: Record<string, unknown>;
  semanticHighlighting?: boolean;
}

export interface TokenColor {
  name?: string;
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

/** VS Code's `uiTheme` / theme `type`, folded to Mochi's four. High-contrast themes fill the slot of their base. */
export type ThemeKind = 'light' | 'dark' | 'hc-light' | 'hc-dark';

export type ThemeSlot = 'light' | 'dark';

export type ThemeSource =
  | { kind: 'mochi' }
  | {
      kind: 'marketplace';
      namespace: string;
      name: string;
      version: string;
      displayName: string;
      publisher: string;
    }
  | { kind: 'custom'; file: string };

export interface ColorTheme {
  /** `mochi`, `ext:<namespace>.<name>:<label>` or `custom:<file>`. */
  id: string;
  label: string;
  kind: ThemeKind;
  source: ThemeSource;
  theme: VsCodeTheme;
}

export const MOCHI_THEME_ID = 'mochi';

export const slotOf = (kind: ThemeKind): ThemeSlot =>
  kind === 'light' || kind === 'hc-light' ? 'light' : 'dark';

/** `uiTheme` in package.json (`vs`, `vs-dark`, `hc-black`, `hc-light`) or a theme file's `type` (`light`, `dark`, `hc`, `hcLight`). */
export function kindOf(uiTheme: unknown, type?: unknown): ThemeKind {
  const raw = uiTheme ?? type;
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (value === 'vs' || value === 'light') return 'light';
  if (value === 'hc-light' || value === 'hclight') return 'hc-light';
  if (value === 'hc-black' || value === 'hc') return 'hc-dark';
  return 'dark';
}

export const marketplaceThemeId = (
  namespace: string,
  name: string,
  label: string,
) => `ext:${namespace}.${name}:${label}`;
