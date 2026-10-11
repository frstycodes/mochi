import { BrowserWindow } from 'electron';
import type { WindowsHost } from '../../src/host/types/windows.ts';
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
} satisfies Handlers<WindowsHost>;
