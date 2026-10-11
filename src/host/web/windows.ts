import type { WindowsHost } from '../types/windows.ts';

export const windows: WindowsHost = {
  async open(route) {
    window.open(`#/${route.replace(/^\/+/, '')}`, '_blank');
  },
};
