import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/index.ts';
import { createWindow, isTrustedUrl } from './window.ts';

app.whenReady().then(() => {
  registerIpc(isTrustedUrl);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
