import { app, BrowserWindow, Notification } from 'electron';
import { playHaptic } from '../haptics/haptics.ts';
import type { NotifyHost } from '../../src/host/types/notify.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

// macOS drops click handlers for notifications that get garbage-collected, so live ones are held until clicked or closed.
const live = new Set<Notification>();

export const notify = {
  async show(sender, notice) {
    const { title, body, id } = record(notice, 'notice');
    const n = new Notification({ title: string(title, 'title', 200), body: body === undefined ? undefined : string(body, 'body', 2000) });
    const clickId = id === undefined ? undefined : string(id, 'id', 200);
    live.add(n);
    n.on('close', () => live.delete(n));
    n.on('click', () => {
      live.delete(n);
      const win = BrowserWindow.fromWebContents(sender);
      if (!win || sender.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (clickId) sender.send('notify:onClick', clickId);
    });
    n.show();
  },
  async setBadge(_sender, count) {
    app.setBadgeCount(integer(count, 'count', 0, 9999));
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
