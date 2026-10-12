import { BrowserWindow, desktopCapturer, shell, systemPreferences } from 'electron';
import type { ScreenAccess, WindowsHost } from '../../src/host/types/windows.ts';
import { openRoute } from '../window.ts';
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
    if (!isAllowed(screenAccess())) return { access: screenAccess(), windows: [] };
    // Asking while not-determined is what shows the macOS prompt; the answer only applies after a relaunch.
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
    const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
    const windows = sources.filter((s) => s.name && !own.has(s.id)).map((s) => ({ id: s.id, title: s.name, icon: s.appIcon?.isEmpty() === false ? s.appIcon.resize({ width: 32 }).toDataURL() : undefined }));
    return { access: screenAccess(), windows };
  },
  async captureApp(_sender, id) {
    string(id, 'id', 256);
    if (!isAllowed(screenAccess())) return null;
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: CAPTURE_SIZE });
    const shot = sources.find((s) => s.id === id)?.thumbnail;
    if (!shot || shot.isEmpty()) return null;
    return { mediaType: 'image/jpeg', data: shot.toJPEG(80).toString('base64') };
  },
  async openScreenRecordingSettings() {
    if (process.platform === 'darwin') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  },
} satisfies Handlers<WindowsHost>;

// Fits inside, keeping the aspect ratio: Claude resizes images whose long edge passes 1568px.
const CAPTURE_SIZE = { width: 1568, height: 1568 };

function screenAccess(): ScreenAccess {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}

const isAllowed = (access: ScreenAccess) => access === 'granted' || access === 'not-determined';
