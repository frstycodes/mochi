import type { ColorTheme } from '../../themes/model.ts';
import type { SearchResult } from '../../themes/openVsx.ts';
import type { Manifest } from './manifest.ts';

/**
 * VS Code color themes (DESIGN.md › Color themes): Open VSX's Themes category and the user's own theme files. The desktop
 * app keeps them under userData/themes; the web build keeps them in browser storage. Main reads only `extension/package.json`
 * and the theme files it names from a downloaded .vsix, never extracting or running anything else.
 */
export interface ThemesHost {
  /** Installed marketplace themes, then custom ones. */
  list(): Promise<ColorTheme[]>;
  search(query: string, offset: number): Promise<SearchResult>;
  /** A version's themes, downloaded and read for preview without installing. */
  inspect(
    namespace: string,
    name: string,
    version: string,
    displayName: string,
  ): Promise<ColorTheme[]>;
  install(
    namespace: string,
    name: string,
    version: string,
    displayName: string,
  ): Promise<ColorTheme[]>;
  uninstall(namespace: string, name: string): Promise<void>;
  /** The OS file picker for a .json/.jsonc theme, `include`s resolved next to it; null when dismissed. */
  importFile(): Promise<ColorTheme | null>;
  /** Saves pasted theme JSON as a new custom theme, or over custom theme `file`. */
  saveCustom(text: string, file?: string): Promise<ColorTheme>;
  readCustom(file: string): Promise<string>;
  /** Opens the custom theme's file in the OS's editor for JSON; desktop only. */
  openCustom(file: string): Promise<void>;
  removeCustom(file: string): Promise<void>;
}

export const themesMethods = {
  list: 'invoke',
  search: 'invoke',
  inspect: 'invoke',
  install: 'invoke',
  uninstall: 'invoke',
  importFile: 'invoke',
  saveCustom: 'invoke',
  readCustom: 'invoke',
  openCustom: 'invoke',
  removeCustom: 'invoke',
} satisfies Manifest<ThemesHost>;
