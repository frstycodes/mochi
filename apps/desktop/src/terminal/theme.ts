import type { ITheme } from '@xterm/xterm';

// xterm parses only hex/rgb, and DESIGN.md tokens are oklch: a 1px canvas resolves each token to rgba for the active theme.
const TOKENS = {
  background: '--card',
  foreground: '--foreground',
  cursor: '--foreground',
  cursorAccent: '--card',
  black: '--subtle-foreground',
  brightBlack: '--muted-foreground',
  white: '--muted-foreground',
  brightWhite: '--foreground',
  red: '--destructive',
  brightRed: '--destructive',
  green: '--success',
  brightGreen: '--success',
  yellow: '--warning',
  brightYellow: '--warning',
  blue: '--chart-1',
  brightBlue: '--chart-1',
  magenta: '--chart-5',
  brightMagenta: '--chart-5',
  cyan: '--chart-3',
  brightCyan: '--chart-3',
} satisfies Partial<Record<keyof ITheme, `--${string}`>>;

let context: CanvasRenderingContext2D | null = null;

export function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const resolve = (token: string, alpha = 1) =>
    toRgba(style.getPropertyValue(token).trim(), alpha);
  const colors = Object.fromEntries(
    Object.entries(TOKENS).map(([key, token]) => [key, resolve(token)]),
  );
  return {
    ...colors,
    selectionBackground: resolve('--foreground', 0.2),
    scrollbarSliderBackground: resolve('--foreground', 0.12),
  };
}

/** Re-runs `apply` when next-themes flips `data-theme`, a color theme rewrites the tokens on <html>, or the OS scheme changes under "system". */
export function onThemeChange(apply: () => void) {
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', apply);
  return () => {
    observer.disconnect();
    scheme.removeEventListener('change', apply);
  };
}

function toRgba(color: string, alpha: number) {
  context ??= document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  if (!context) return color;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${((a / 255) * alpha).toFixed(3)})`;
}
