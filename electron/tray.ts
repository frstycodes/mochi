import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { showMainWindow } from './window.ts';

let tray: Tray | undefined;

/**
 * Windows and Linux: closing the last window leaves Mochi running (agents, schedules) behind a tray icon, the way macOS keeps
 * it in the Dock. Launching it again opens a window (`second-instance`), which also covers Linux desktops that show no tray.
 */
export function startTray() {
  app.on('second-instance', showMainWindow);
  // 1024px source; 32px stays sharp at 2x and is scaled down where the tray is smaller.
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 32, height: 32 }));
  tray.setToolTip('Mochi');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Mochi', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit Mochi', click: () => app.quit() },
    ]),
  );
  tray.on('click', showMainWindow);
}

const iconPath = () => (app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(import.meta.dirname, '../build/icon.png'));
