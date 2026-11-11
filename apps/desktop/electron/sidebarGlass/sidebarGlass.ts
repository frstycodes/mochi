import { release } from 'node:os';
import type { BrowserWindow } from 'electron';
import { nativeHelper, OBJC_ADDON } from '../native.ts';
import addonSource from './sidebarGlass.mm?raw';

/** Puts macOS's glass under `win`'s page, over `backing` (`#rrggbb`). False where there's none: before macOS 26, or no Xcode to build it in dev. */
export async function showSidebarGlass(win: BrowserWindow, backing: string) {
  addon ??= load();
  const glass = await addon;
  if (!glass || win.isDestroyed()) return false;
  // Clears the page's own backing. It clears the NSWindow's colour too, so it runs before `show` sets that.
  win.setBackgroundColor('#00000000');
  return glass.show(
    win.getNativeWindowHandle(),
    hasAppKitSidebar(),
    Number.parseInt(backing.slice(1), 16),
    Math.ceil(GLASS_WIDTH_PX * win.webContents.getZoomFactor()),
  );
}

interface SidebarGlassAddon {
  show(
    handle: Buffer,
    isAppKitSidebar: boolean,
    backing: number,
    width: number,
  ): boolean;
}

// The sidebar's widest (MAX_PX in src/SidebarResizer.tsx): the opaque page covers whatever of the strip the sidebar doesn't,
// so nothing has to report the sidebar's width as it's dragged, folded or peeked.
const GLASS_WIDTH_PX = 420;

let addon: Promise<SidebarGlassAddon | null> | undefined;

// As Claude's desktop app splits it: AppKit's own sidebar from macOS 27 (Darwin 26), a plain glass view on macOS 26.
const hasAppKitSidebar = () => Number(release().split('.')[0]) >= 26;

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
