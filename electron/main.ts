import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { stopAllCompares } from './browser/compare.ts';
import { registerIpc } from './ipc/index.ts';
import { startWatch } from './notify/watch.ts';
import { startScheduler } from './schedule/scheduler.ts';
import { createWindow, isTrustedUrl } from './window.ts';

// Dev runs can keep their data apart (one Mochi per session or test) without touching the real profile.
if (!app.isPackaged && process.env.MOCHI_USER_DATA) app.setPath('userData', process.env.MOCHI_USER_DATA);

app.whenReady().then(() => {
  // Packaged builds get the icon from the bundle (`build/icon.icns`); dev runs inside Electron.app.
  if (!app.isPackaged) app.dock?.setIcon(path.join(import.meta.dirname, '../build/icon.png'));
  registerIpc(isTrustedUrl);
  startWatch();
  void startScheduler();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('will-quit', stopAllCompares);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
