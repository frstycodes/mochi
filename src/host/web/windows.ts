import type { WindowsHost } from '../types/windows.ts';

let channel: BroadcastChannel | null | undefined;

// Tabs of the same origin talk over one channel, opened on first use (an open channel keeps Node's test runner alive). Without the API each tab stands alone.
function tabs() {
  channel ??=
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('harness.windows');
  return channel;
}

export const windows: WindowsHost = {
  async open(route) {
    window.open(`#/${route.replace(/^\/+/, '')}`, '_blank');
  },
  async broadcast(message) {
    tabs()?.postMessage(message);
  },
  onMessage(listener) {
    const forward = (e: MessageEvent) => listener(e.data);
    tabs()?.addEventListener('message', forward);
    return () => tabs()?.removeEventListener('message', forward);
  },
  async isFullScreen() {
    return false;
  },
  onFullScreenChange() {
    return () => {};
  },
  async zoomFactor() {
    return 1;
  },
  async showAppMenu() {},
  async resetZoom() {},
  async setAppearance() {},
  async listApps() {
    return { access: 'unsupported', windows: [] };
  },
  async captureApp() {
    return null;
  },
  async openScreenRecordingSettings() {},
};
