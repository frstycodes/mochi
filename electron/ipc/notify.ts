import { BrowserWindow, Notification } from 'electron';
import { playHaptic } from '../haptics/haptics.ts';
import { closeAddressed, watch } from '../notify/watch.ts';
import type { NotifyHost } from '../../src/host/types/notify.ts';
import type { Handlers } from './handlers.ts';

// macOS drops click handlers for notifications that get garbage-collected, so live ones are held until clicked or closed.
const live = new Set<Notification>();
/** The renderer's notice id → its notification, for `close`. */
const byId = new Map<string, Notification>();

export const notify = {
  async show(sender, notice) {
    const { title, body, id: clickId } = notice;
    const n = new Notification({ title, body });
    live.add(n);
    if (clickId) byId.set(clickId, n);
    const forget = () => {
      live.delete(n);
      if (clickId && byId.get(clickId) === n) byId.delete(clickId);
    };
    n.on('close', forget);
    n.on('click', () => {
      forget();
      const win = BrowserWindow.fromWebContents(sender);
      if (!win || sender.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (clickId) sender.send('notify:onClick', clickId);
    });
    n.show();
  },
  async close(_sender, ids) {
    for (const id of ids) {
      const n = byId.get(id);
      if (!n) continue;
      n.close();
      live.delete(n);
      byId.delete(id);
    }
  },
  async addressed(_sender, addressed) {
    closeAddressed({
      threadId: addressed.threadId,
      isViewed: addressed.isViewed === true,
      isActedOn: addressed.isActedOn === true,
    });
  },
  async watch(_sender, config) {
    watch.set(config);
  },
  async pendingOpen() {
    return watch.takePendingOpen();
  },
  async haptic() {
    playHaptic();
  },
  async permission() {
    return Notification.isSupported() ? 'granted' : 'denied';
  },
  async requestPermission() {
    return Notification.isSupported() ? 'granted' : 'denied';
  },
} satisfies Handlers<NotifyHost>;
