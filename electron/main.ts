import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc/index.ts';
import { createWindow, isTrustedUrl } from './window.ts';

app.whenReady().then(() => {
  // Packaged builds get the icon from the bundle (`build/icon.icns`); dev runs inside Electron.app.
  if (!app.isPackaged) app.dock?.setIcon(path.join(import.meta.dirname, '../build/icon.png'));
  registerIpc(isTrustedUrl);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
