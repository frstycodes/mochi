import type { HostBridge } from '../types/index.ts';

declare global {
  interface Window {
    harnessHost?: HostBridge;
  }
}

export function bridge(): HostBridge {
  if (!window.harnessHost) throw new Error('window.harnessHost is missing: not running in the desktop app');
  return window.harnessHost;
}
