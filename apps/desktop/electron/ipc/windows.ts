import {
  BrowserWindow,
  Menu,
  nativeTheme,
  shell,
  systemPreferences,
} from 'electron';
import type {
  ScreenAccess,
  WindowsHost,
} from '../../src/host/types/windows.ts';
import { fitWindowButtons, openRoute } from '../window.ts';
import { captureAppWindow, listAppWindows } from '../windows/appWindows.ts';
import type { Handlers } from './handlers.ts';

export const windows = {
  async open(_sender, route) {
    const path = route.replace(/^\/+/, '');
    openRoute(path);
  },
  async broadcast(sender, message) {
    for (const win of BrowserWindow.getAllWindows())
      if (win.webContents !== sender)
        win.webContents.send('windows:onMessage', message);
  },
  async isFullScreen(sender) {
    return BrowserWindow.fromWebContents(sender)?.isFullScreen() ?? false;
  },
  async zoomFactor(sender) {
    const win = BrowserWindow.fromWebContents(sender);
    if (win) fitWindowButtons(win);
    return sender.getZoomFactor();
  },
  async showAppMenu(sender, x, y) {
    const window = BrowserWindow.fromWebContents(sender);
    if (!window) return;
    const zoom = sender.getZoomFactor();
    Menu.getApplicationMenu()?.popup({
      window,
      x: Math.round(x * zoom),
      y: Math.round(y * zoom),
    });
  },
  async resetZoom(sender) {
    sender.setZoomLevel(0);
  },
  async setAppearance(_sender, appearance) {
    nativeTheme.themeSource = appearance;
  },
  async listApps() {
    // Asking while not-determined is what shows the macOS prompt; the answer only applies after a relaunch.
    if (!isAllowed(screenAccess()))
      return { access: screenAccess(), windows: [] };
    return { access: screenAccess(), windows: await listAppWindows() };
  },
  async captureApp(_sender, id) {
    if (!isAllowed(screenAccess())) return null;
    return captureAppWindow(id);
  },
  async openScreenRecordingSettings() {
    if (process.platform === 'darwin')
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
  },
} satisfies Handlers<WindowsHost>;

function screenAccess(): ScreenAccess {
  return process.platform === 'darwin'
    ? systemPreferences.getMediaAccessStatus('screen')
    : 'granted';
}

const isAllowed = (access: ScreenAccess) =>
  access === 'granted' || access === 'not-determined';
