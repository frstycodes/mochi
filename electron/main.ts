import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { stopAllCompares } from './browser/compare.ts';
import { registerIpc } from './ipc/index.ts';
import { startWatch } from './notify/watch.ts';
import { startScheduler } from './schedule/scheduler.ts';
import { startTray } from './tray.ts';
import { createWindow, isTrustedUrl } from './window.ts';

// Dev runs can keep their data apart (one Mochi per session or test) without touching the real profile.
if (!app.isPackaged && process.env.MOCHI_USER_DATA) app.setPath('userData', process.env.MOCHI_USER_DATA);

const hasTray = process.platform !== 'darwin';
// One Mochi per profile on Windows and Linux: a second launch opens a window in the running one (`startTray`).
if (hasTray && !app.requestSingleInstanceLock()) app.exit();

app.whenReady().then(() => {
  // Packaged builds get the icon from the bundle (`build/icon.icns`); dev runs inside Electron.app.
  if (!app.isPackaged) app.dock?.setIcon(path.join(import.meta.dirname, '../build/icon.png'));
  registerIpc(isTrustedUrl);
  startWatch();
  void startScheduler();
  createWindow();
  if (hasTray) startTray();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('will-quit', stopAllCompares);
// Every platform keeps running with no windows: macOS in the Dock, Windows and Linux in the tray. Quit is explicit.
app.on('window-all-closed', () => {});
