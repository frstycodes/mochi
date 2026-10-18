import { app, BrowserWindow } from 'electron';
import { installHooks } from './git/hooks.ts';
import path from 'node:path';
import { stopAllCompares } from './browser/compare.ts';
import { setImageDir } from './agents/images.ts';
import { registerIpc } from './ipc/index.ts';
import { startLibraryUpdates } from './library/updates.ts';
import { startRemote } from './remote/index.ts';
import { startWatch } from './notify/watch.ts';
import { startScheduler } from './schedule/scheduler.ts';
import { startTray } from './tray.ts';
import { appIconImage, startAppIcon } from './appIcon.ts';
import { createWindow, isTrustedUrl, showMainWindow } from './window.ts';

// Dev runs can keep their data apart (one Mochi per session or test) without touching the real profile.
if (!app.isPackaged && process.env.MOCHI_USER_DATA) app.setPath('userData', process.env.MOCHI_USER_DATA);
setImageDir(path.join(app.getPath('userData'), 'images'));

const hasTray = process.platform !== 'darwin';
// One Mochi per profile on Windows and Linux: a second launch opens a window in the running one (`startTray`).
if (hasTray && !app.requestSingleInstanceLock()) app.exit();

app.whenReady().then(() => {
  startAppIcon();
  registerIpc(isTrustedUrl);
  startWatch();
  void startScheduler();
  startLibraryUpdates();
  installHooks().catch((error: unknown) => console.warn('Git hooks not installed; agents commit without the message check', error));
  // Before the first window: it watches every window's close.
  startRemote();
  createWindow();
  if (hasTray) startTray(appIconImage());
  // The main window may be hidden rather than closed (remote devices keep its store running).
  app.on('activate', () => BrowserWindow.getAllWindows().some((w) => w.isVisible()) || showMainWindow());
});

app.on('will-quit', stopAllCompares);
// Every platform keeps running with no windows: macOS in the Dock, Windows and Linux in the tray. Quit is explicit.
app.on('window-all-closed', () => {});
