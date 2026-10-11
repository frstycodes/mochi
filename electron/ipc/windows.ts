import type { WindowsHost } from '../../src/host/types/windows.ts';
import { createWindow } from '../window.ts';
import { string, type Handlers } from './handlers.ts';

export const windows = {
  async open(_sender, route) {
    const path = string(route, 'route', 200).replace(/^\/+/, '');
    if (!/^[\w\-/.]*$/.test(path)) throw new TypeError('route may only contain letters, digits, - _ . /');
    createWindow(path);
  },
} satisfies Handlers<WindowsHost>;
