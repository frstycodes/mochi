import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { host } from '../host';
import type { SystemFont } from '../host/types/settings.ts';
import { queryKeys } from '../queryKeys.ts';
import { usePrefs, type Prefs } from './prefs.ts';
import { SYSTEM_FONT, type FontKind } from './settingOptions.ts';

// The same stacks as --font-sans and --font-mono in index.css, which apply while no font is picked.
const FALLBACK_STACK = {
  ui: 'system-ui, -apple-system, sans-serif',
  mono: "'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace",
} satisfies Record<FontKind, string>;

/** A CSS font-family list for a picked family ('' is the default), ending in the default so a missing font falls back. */
export function fontStack(kind: FontKind, family: string) {
  if (family === SYSTEM_FONT[kind]) {
    return kind === 'ui'
      ? 'system-ui, -apple-system, sans-serif'
      : "ui-monospace, 'SF Mono', Menlo, monospace";
  }
  const name = family.replace(/["\\]/g, '');
  return name ? `"${name}", ${FALLBACK_STACK[kind]}` : FALLBACK_STACK[kind];
}

// Prose at 13, 14 and 16px; every other text token keeps its ratio to it.
const TEXT_SCALE = {
  small: 13 / 14,
  default: 1,
  large: 16 / 14,
} satisfies Record<Prefs['uiTextSize'], number>;

// The family a font picker has highlighted, painted app-wide until it closes, like the theme picker's preview.
const previewStore = createStore<Partial<Record<FontKind, string>>>(() => ({}));

export function setFontPreview(kind: FontKind, family: string | undefined) {
  previewStore.setState({ [kind]: family });
}

/** Puts the font prefs (or a picker's highlighted family) on the root, where index.css reads them. */
export function useApplyFonts() {
  const prefs = usePrefs();
  const preview = useStore(previewStore);
  const uiFont = preview.ui ?? prefs.uiFont;
  const monoFont = preview.mono ?? prefs.monoFont;
  const { uiTextSize, codeFontSize } = prefs;
  useEffect(() => {
    const { style } = document.documentElement;
    setOrClear(style, '--font-sans', uiFont && fontStack('ui', uiFont));
    setOrClear(style, '--font-mono', monoFont && fontStack('mono', monoFont));
    style.setProperty('--text-scale', String(TEXT_SCALE[uiTextSize]));
    style.setProperty('--code-font-size', `${codeFontSize}px`);
  }, [uiFont, monoFont, uiTextSize, codeFontSize]);
}

function setOrClear(style: CSSStyleDeclaration, name: string, value: string) {
  if (value) style.setProperty(name, value);
  else style.removeProperty(name);
}

/** Installed families; null where the platform can't list them (web, Windows), so nothing reads as missing there. */
export function useSystemFonts() {
  const fontsQuery = useQuery({
    queryKey: queryKeys.systemFonts(),
    queryFn: () => host.settings.systemFonts(),
    staleTime: 10 * 60_000,
  });
  return fontsQuery.data;
}

/** A picked family the font list doesn't have. Unknown while the list loads or can't be read. */
export function isMissingFont(
  family: string,
  fonts: SystemFont[] | null | undefined,
) {
  if (!family || !fonts) return false;
  if (family === SYSTEM_FONT.ui || family === SYSTEM_FONT.mono) return false;
  const name = family.toLowerCase();
  return !fonts.some((f) => f.family.toLowerCase() === name);
}
