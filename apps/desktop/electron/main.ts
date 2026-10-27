import { app, BrowserWindow, crashReporter } from 'electron';
import { startDevMcp } from './mcp/server.ts';
import path from 'node:path';
import { stopAllCompares } from './browser/compare.ts';
import { setImageDir } from '@mochi/core/agents/images';
import { mainCapabilities } from './ipc/index.ts';
import { startLibraryUpdates } from './library/updates.ts';
import { startRemote } from './remote/index.ts';
import { startWatch } from './notify/watch.ts';
import { startScheduler } from './schedule/scheduler.ts';
import { startTray } from './tray.ts';
import { startUpdates } from './updates/updater.ts';
import { appIconImage, startAppIcon } from './appIcon.ts';
import { createWindow, isTrustedUrl, showMainWindow } from './window.ts';
import { serveFrames } from './frameProtocol.ts';
import { startCore } from '@mochi/core/host';
import './fs/watch.ts';

// Dev runs can keep their data apart (one Mochi per session or test) without touching the real profile.
if (!app.isPackaged && process.env.MOCHI_USER_DATA)
  app.setPath('userData', process.env.MOCHI_USER_DATA);
// Dev binaries are ad-hoc signed, so every rebuild re-prompts for the keychain; a fixed key instead.
// Secrets a dev build saves are not protected, and ones saved before this switch won't decrypt.
if (!app.isPackaged) app.commandLine.appendSwitch('use-mock-keychain');
setImageDir(path.join(app.getPath('userData'), 'images'));
// Minidumps stay local, under `app.getPath('crashDumps')`.
crashReporter.start({ uploadToServer: false });
process.on('uncaughtException', (error) =>
  console.error('Uncaught exception in main', error),
);
process.on('unhandledRejection', (reason) =>
  console.error('Unhandled rejection in main', reason),
);

const hasTray = process.platform !== 'darwin';
// One Mochi per profile on Windows and Linux: a second launch opens a window in the running one (`startTray`).
if (hasTray && !app.requestSingleInstanceLock()) app.exit();
serveFrames();

app
  .whenReady()
  .then(() =>
    startCore({
      isTrusted: isTrustedUrl,
      origins: [
        process.env.VITE_DEV_SERVER_URL
          ? new URL(process.env.VITE_DEV_SERVER_URL).origin
          : 'file://',
      ],
      capabilities: mainCapabilities,
    }),
  )
  .then(() => {
    startAppIcon();
    startWatch();
    startScheduler();
    startLibraryUpdates();
    startUpdates();
    // Before the first window: it watches every window's close.
    startRemote();
    createWindow();
    void startDevMcp().catch((error: unknown) =>
      console.error('Dev MCP failed', error),
    );
    if (hasTray) startTray(appIconImage());
    // The main window may be hidden rather than closed (remote devices keep its store running).
    app.on(
      'activate',
      () =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible()) ||
        showMainWindow(),
    );
  });

app.on('will-quit', stopAllCompares);
// Every platform keeps running with no windows: macOS in the Dock, Windows and Linux in the tray. Quit is explicit.
app.on('window-all-closed', () => {});
