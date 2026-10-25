import { parseJsonc } from './jsonc.ts';
import {
  kindOf,
  type ThemeKind,
  type TokenColor,
  type VsCodeTheme,
} from './model.ts';
import { openZip, type Inflate } from './zip.ts';

export const LIMITS = {
  /** A downloaded .vsix. */
  packageBytes: 25 * 1024 * 1024,
  /** package.json or one theme file, uncompressed. */
  fileBytes: 4 * 1024 * 1024,
  includeDepth: 8,
  themesPerPackage: 64,
};

export interface ExtractedTheme {
  label: string;
  kind: ThemeKind;
  theme: VsCodeTheme;
}

/** A package path relative to its root (`themes/dark.json`), and a reader for it. */
export type ReadFile = (path: string) => Promise<string>;

/**
 * The color themes a .vsix contributes: reads `extension/package.json`, then only the theme files its `contributes.themes`
 * names and the files their `include` chains reach, all inside `extension/`. Nothing else in the package is read.
 */
export async function extractThemes(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<ExtractedTheme[]> {
  if (bytes.length > LIMITS.packageBytes)
    throw new Error(
      `The package is larger than ${LIMITS.packageBytes / 1024 / 1024} MB`,
    );
  const zip = openZip(bytes, inflate);
  const decoder = new TextDecoder();
  const read: ReadFile = async (path) =>
    decoder.decode(await zip.read(`extension/${path}`, LIMITS.fileBytes));
  const manifest = parseJsonc(await read('package.json')) as {
    contributes?: { themes?: unknown };
  };
  const contributed = manifest?.contributes?.themes;
  if (!Array.isArray(contributed)) return [];
  const themes: ExtractedTheme[] = [];
  for (const entry of contributed.slice(0, LIMITS.themesPerPackage)) {
    if (!entry || typeof entry.path !== 'string') continue;
    const theme = await loadTheme(resolvePath('', entry.path), read);
    const label =
      typeof entry.label === 'string' && entry.label
        ? entry.label
        : (theme.name ?? entry.path);
    themes.push({ label, kind: kindOf(entry.uiTheme, theme.type), theme });
  }
  return themes;
}

/** A theme file with its `include` chain merged in (the included file first, the including one on top). */
export async function loadTheme(
  path: string,
  read: ReadFile,
  depth = 0,
  seen = new Set<string>(),
): Promise<VsCodeTheme> {
  if (depth > LIMITS.includeDepth)
    throw new Error(
      `${path}: include chain is deeper than ${LIMITS.includeDepth}`,
    );
  if (seen.has(path)) throw new Error(`${path}: include cycle`);
  seen.add(path);
  const raw = parseJsonc(await read(path));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`${path} is not a theme object`);
  const own = raw as Record<string, unknown>;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const base =
    typeof own.include === 'string'
      ? await loadTheme(resolvePath(dir, own.include), read, depth + 1, seen)
      : undefined;
  const tokenColors = await ownTokenColors(own.tokenColors, dir, read);
  return {
    name: typeof own.name === 'string' ? own.name : base?.name,
    type: typeof own.type === 'string' ? own.type : base?.type,
    colors: { ...base?.colors, ...stringRecord(own.colors) },
    tokenColors: [...(base?.tokenColors ?? []), ...tokenColors],
    semanticTokenColors: {
      ...base?.semanticTokenColors,
      ...(isRecord(own.semanticTokenColors) ? own.semanticTokenColors : {}),
    },
    semanticHighlighting:
      typeof own.semanticHighlighting === 'boolean'
        ? own.semanticHighlighting
        : base?.semanticHighlighting,
  };
}

/** Parses a pasted or imported theme that has no package around it; `include` needs a file to resolve against. */
export function parseTheme(text: string): VsCodeTheme {
  const raw = parseJsonc(text);
  if (!isRecord(raw)) throw new Error('A theme is a JSON object');
  if (typeof raw.include === 'string')
    throw new Error(
      'This theme includes another file: import it as a file instead of pasting',
    );
  if (typeof raw.tokenColors === 'string')
    throw new Error(
      'Its tokenColors point to another file: import it as a file instead of pasting',
    );
  if (!isRecord(raw.colors) && !Array.isArray(raw.tokenColors))
    throw new Error('A color theme needs colors or tokenColors');
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    colors: stringRecord(raw.colors),
    tokenColors: tokenColorList(raw.tokenColors),
    semanticTokenColors: isRecord(raw.semanticTokenColors)
      ? raw.semanticTokenColors
      : {},
  };
}

/**
 * `relative` joined onto the package directory `dir`, both slash-separated and relative to the package root. Throws when
 * the result leaves the root, or `relative` is absolute or names a drive or URL.
 */
export function resolvePath(dir: string, relative: string): string {
  const path = relative.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path))
    throw new Error(`${relative} must be a path inside the package`);
  const parts = dir.split('/').filter(Boolean);
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') parts.push(segment);
    else if (!parts.pop())
      throw new Error(`${relative} points outside the package`);
  }
  if (!parts.length) throw new Error(`${relative} is not a file`);
  return parts.join('/');
}

// ponytail: a `tokenColors` pointing at a .tmTheme (plist) is skipped, so those themes only recolor the UI; parse plist if one is asked for.
async function ownTokenColors(
  value: unknown,
  dir: string,
  read: ReadFile,
): Promise<TokenColor[]> {
  if (typeof value !== 'string') return tokenColorList(value);
  if (!/\.jsonc?$/i.test(value)) return [];
  return tokenColorList(parseJsonc(await read(resolvePath(dir, value))));
}

function tokenColorList(value: unknown): TokenColor[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is TokenColor => isRecord(rule) && isRecord(rule.settings),
  );
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
