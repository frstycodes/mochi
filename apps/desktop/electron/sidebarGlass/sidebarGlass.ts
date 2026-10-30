import type { BrowserWindow } from 'electron';
import { nativeHelper, OBJC_ADDON } from '../native.ts';
import addonSource from './sidebarGlass.mm?raw';

interface SidebarGlassAddon {
  attach(handle: Buffer): boolean;
}

let addon: Promise<SidebarGlassAddon | null> | undefined;

/** Puts AppKit's sidebar glass behind `win`'s page. False where there's none: before macOS 26, or no Xcode to build it in dev. */
export async function attachSidebarGlass(win: BrowserWindow) {
  addon ??= load();
  const glass = await addon;
  return (
    !!glass && !win.isDestroyed() && glass.attach(win.getNativeWindowHandle())
  );
}

async function load() {
  const binary = await nativeHelper('sidebar-glass', addonSource, OBJC_ADDON);
  if (!binary) return null;
  const module = { exports: {} as SidebarGlassAddon };
  try {
    process.dlopen(module, binary);
    return module.exports;
  } catch (error) {
    console.warn('Sidebar glass unavailable', error);
    return null;
  }
}
