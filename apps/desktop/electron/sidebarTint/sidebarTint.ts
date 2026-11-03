import { nativeTheme, type BrowserWindow } from 'electron';
import { nativeHelper, OBJC_ADDON } from '../native.ts';
import addonSource from './sidebarTint.mm?raw';

type Rgba = [number, number, number, number];

interface SidebarTintAddon {
  setSidebarTint(
    handle: Buffer,
    tint: { width: number; rgba: Rgba; glass?: boolean },
  ): void;
  clearTint(handle: Buffer): void;
  isGlassSupported(): boolean;
}

// Tuned by eye over the `sidebar` material. Inactive windows halve it, following AppKit's own dimming of the material.
const TINTS = {
  light: [1, 1, 1, 0.1],
  dark: [0, 0, 0, 0.12],
} satisfies Record<string, Rgba>;
const INACTIVE_ALPHA = 0.5;

interface Tracked {
  /** The sidebar's last width in CSS px. */
  width: number;
  isGlass: boolean;
  onFail: () => void;
}

/** Windows with a native material under the sidebar; any other window gets none. */
const tracked = new WeakMap<BrowserWindow, Tracked>();
let addon: Promise<SidebarTintAddon | null> | undefined;

/** Lets the renderer size `win`'s sidebar material: an NSGlassEffectView strip with `isGlass`, else a tint over its vibrancy or AppKit glass. `onFail` once the add-on can't. */
export function trackSidebarTint(
  win: BrowserWindow,
  isGlass: boolean,
  onFail: () => void,
) {
  tracked.set(win, { width: 0, isGlass, onFail });
  win.on('focus', () => void tintSidebar(win));
  win.on('blur', () => void tintSidebar(win));
}

/** Sizes the sidebar's strip of material, `width` CSS px wide (0 clears it); without a width, refits the last one to the theme, zoom and focus. */
export async function tintSidebar(win: BrowserWindow, width?: number) {
  const state = tracked.get(win);
  if (!state) return;
  if (width !== undefined) state.width = width;
  addon ??= load();
  const tint = await addon;
  if (win.isDestroyed()) return;
  if (!tint || (state.isGlass && !tint.isGlassSupported())) return fail(win);
  const [r, g, b, a] = nativeTheme.shouldUseDarkColors
    ? TINTS.dark
    : TINTS.light;
  try {
    const handle = win.getNativeWindowHandle();
    if (state.width === 0) return tint.clearTint(handle);
    tint.setSidebarTint(handle, {
      width: state.width * win.webContents.getZoomFactor(),
      rgba: [r, g, b, win.isFocused() ? a : a * INACTIVE_ALPHA],
      glass: state.isGlass,
    });
  } catch (error) {
    console.warn('Sidebar material failed, the sidebar stays solid', error);
    fail(win);
  }
}

function fail(win: BrowserWindow) {
  tracked.get(win)?.onFail();
  tracked.delete(win);
}

async function load() {
  const binary = await nativeHelper('sidebar-tint', addonSource, OBJC_ADDON);
  if (!binary) return null;
  const module = { exports: {} as SidebarTintAddon };
  try {
    process.dlopen(module, binary);
    return module.exports;
  } catch (error) {
    console.warn('Sidebar tint unavailable', error);
    return null;
  }
}
