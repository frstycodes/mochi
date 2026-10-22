import { app, BrowserWindow, MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { Effect } from 'effect';
import path from 'node:path';
import { connectCore } from './client.ts';

const RESTART_DELAY_MS = 1000;
let mainConnection: ReturnType<typeof connectCore> | undefined;

/**
 * Main's side: forks Core, restarts it when it exits, and hands a fresh port to main and to every window
 * whose page passes `isTrusted`, on each load and each restart. Preload forwards it as a `core:port` window message,
 * since a port can't cross contextBridge.
 */
export function startCore(isTrusted: (url: string) => boolean) {
  // Bundled into dist-electron/main.js, beside the `core` entry.
  const entry = path.join(import.meta.dirname, 'core.js');
  const env = { ...process.env, MOCHI_LOG_FILE: path.join(app.getPath('logs'), 'mochi.log') };
  let core: UtilityProcess;
  let isQuitting = false;

  const connectWindow = (contents: WebContents) => {
    if (!isTrusted(contents.getURL())) return;
    const { port1, port2 } = new MessageChannelMain();
    core.postMessage(null, [port1]);
    contents.postMessage('core:port', null, [port2]);
  };
  const connectMain = () => {
    const { port1, port2 } = new MessageChannelMain();
    core.postMessage(null, [port1]);
    void mainConnection?.then(({ close }) => close());
    mainConnection = connectCore(port2);
  };
  const spawn = () => {
    core = utilityProcess.fork(entry, [], { serviceName: 'Mochi Core', env });
    core.once('exit', (code) => {
      if (isQuitting) return;
      setTimeout(() => {
        spawn();
        logToCore('Warn', `Core exited (${code}), restarted`);
      }, RESTART_DELAY_MS);
    });
    connectMain();
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isLoading()) connectWindow(win.webContents);
  };

  app.on('browser-window-created', (_event, win) => win.webContents.on('did-finish-load', () => connectWindow(win.webContents)));
  app.on('will-quit', () => {
    isQuitting = true;
    core.kill();
  });
  spawn();
}

/** Main's log lines go to Core's file. Lines sent while Core restarts are lost. */
export function logToCore(level: 'Debug' | 'Info' | 'Warn' | 'Error', message: string) {
  void mainConnection?.then(({ client }) => Effect.runPromise(client.log({ level, source: 'main', message })));
}
