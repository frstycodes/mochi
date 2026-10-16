import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTheme } from 'next-themes';
import { host } from '@/host';
import { APPEARANCES, type Appearance } from '@/host/types/windows';
import { themeTokens } from './map';
import { refreshThemes, useColorTheme } from './store';

/**
 * Paints the color theme on screen: its tokens as inline custom properties on <html> (beating index.css's Mochi values),
 * `data-theme` and `color-scheme` for its mode. Mochi itself is no properties at all. Mounted once inside ThemeProvider.
 */
export function ColorThemeController() {
  const { mode, theme } = useColorTheme();
  const tokens = useMemo(() => (theme ? themeTokens(theme.theme, theme.kind) : {}), [theme]);
  const applied = useRef<string[]>([]);
  const { theme: appearance } = useTheme();

  useEffect(() => {
    if (APPEARANCES.includes(appearance as Appearance)) void host.windows.setAppearance(appearance as Appearance);
  }, [appearance]);

  useEffect(() => {
    void refreshThemes().catch((error: Error) => console.warn('themes: could not list installed themes:', error.message));
    // A custom theme edited in another app shows up when you come back.
    const onFocus = () => void refreshThemes().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const restore = pauseTransitions();
    for (const name of applied.current) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
    applied.current = Object.keys(tokens);
    // next-themes writes these too, but only when Light / Dark / System changes; a preview can flip the mode under it.
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
    restore();
  }, [tokens, mode]);

  return null;
}

/** Like next-themes' disableTransitionOnChange: hover and color transitions would otherwise fade the whole UI per theme. */
function pauseTransitions() {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  return () => {
    void getComputedStyle(document.body).opacity;
    setTimeout(() => style.remove(), 1);
  };
}
