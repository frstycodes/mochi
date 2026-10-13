import { BrowserWindow, shell, systemPreferences } from 'electron';
import type { ScreenAccess, WindowsHost } from '../../src/host/types/windows.ts';
import { openRoute } from '../window.ts';
import { captureAppWindow, listAppWindows } from '../windows/appWindows.ts';
import { record, string, type Handlers } from './handlers.ts';

export const windows = {
  async open(_sender, route) {
    const path = string(route, 'route', 200).replace(/^\/+/, '');
    if (!/^[\w\-/.]*$/.test(path)) throw new TypeError('route may only contain letters, digits, - _ . /');
    openRoute(path);
  },
  async broadcast(sender, message) {
    const payload = record(message, 'message');
    for (const win of BrowserWindow.getAllWindows()) if (win.webContents !== sender) win.webContents.send('windows:onMessage', payload);
  },
  async isFullScreen(sender) {
    return BrowserWindow.fromWebContents(sender)?.isFullScreen() ?? false;
  },
  async listApps() {
    // Asking while not-determined is what shows the macOS prompt; the answer only applies after a relaunch.
    if (!isAllowed(screenAccess())) return { access: screenAccess(), windows: [] };
    return { access: screenAccess(), windows: await listAppWindows() };
  },
  async captureApp(_sender, id) {
    string(id, 'id', 256);
    if (!isAllowed(screenAccess())) return null;
    return captureAppWindow(id as string);
  },
  async openScreenRecordingSettings() {
    if (process.platform === 'darwin') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  },
} satisfies Handlers<WindowsHost>;

function screenAccess(): ScreenAccess {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}

const isAllowed = (access: ScreenAccess) => access === 'granted' || access === 'not-determined';
