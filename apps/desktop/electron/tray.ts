import { app, Menu, Tray, type NativeImage } from 'electron';
import { showMainWindow } from './window.ts';

let tray: Tray | undefined;

/**
 * Windows and Linux: closing the last window leaves Mochi running (agents, schedules) behind a tray icon, the way macOS keeps
 * it in the Dock. Launching it again opens a window (`second-instance`), which also covers Linux desktops that show no tray.
 */
export function startTray(icon: NativeImage) {
  app.on('second-instance', showMainWindow);
  tray = new Tray(trayImage(icon));
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

export function setTrayImage(icon: NativeImage) {
  tray?.setImage(trayImage(icon));
}

// 1024px source; 32px stays sharp at 2x and is scaled down where the tray is smaller.
const trayImage = (icon: NativeImage) => icon.resize({ width: 32, height: 32 });
