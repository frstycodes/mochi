import { app, BrowserWindow, powerMonitor } from 'electron';
import { onAgentEvent } from '../agents/events.ts';
import { callCore } from './watchClient.ts';

const WINDOW_EVENTS = ['show', 'hide', 'minimize', 'restore', 'closed'] as const;

// Imported by electron/main.ts for this; powerMonitor works only once the app is ready.
void app.whenReady().then(reportToWatch);

/**
 * Tells Core's watch service what it can't see from its own process: whether any window is visible, the machine's sleep
 * and power source, and an agent's file-changing tool ending.
 */
function reportToWatch() {
  let isAsleep = false;
  const gate = () => ({
    isVisible: BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized()),
    isAsleep,
    isOnBattery: powerMonitor.isOnBatteryPower(),
  });
  // `closed` fires before the window leaves getAllWindows; the next tick sees it gone.
  const send = () => setImmediate(() => void callCore((core) => core['watch.gate'](gate())));
  powerMonitor.on('suspend', () => ((isAsleep = true), send()));
  powerMonitor.on('resume', () => ((isAsleep = false), send()));
  powerMonitor.on('on-battery', send);
  powerMonitor.on('on-ac', send);
  app.on('browser-window-created', (_event, win) => {
    for (const name of WINDOW_EVENTS) win.on(name as 'show', send);
    send();
  });
  onAgentEvent((event) => {
    if (event.type === 'tool' && event.phase === 'end' && (!!event.files?.length || event.exitCode !== undefined)) void callCore((core) => core['watch.stale']({ kinds: ['git', 'ports'] }));
  });
}
