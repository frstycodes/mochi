import { BrowserWindow, Notification } from 'electron';
import { playHaptic } from '../haptics/haptics.ts';
import { closeAddressed, watch } from '../notify/watch.ts';
import type { NotifyHost, WatchConfig } from '../../src/host/types/notify.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

// macOS drops click handlers for notifications that get garbage-collected, so live ones are held until clicked or closed.
const live = new Set<Notification>();
/** The renderer's notice id → its notification, for `close`. */
const byId = new Map<string, Notification>();

export const notify = {
  async show(sender, notice) {
    const { title, body, id } = record(notice, 'notice');
    const n = new Notification({ title: string(title, 'title', 200), body: body === undefined ? undefined : string(body, 'body', 2000) });
    const clickId = id === undefined ? undefined : string(id, 'id', 200);
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
  async close(_sender, value) {
    for (const id of list(value, 'ids')) {
      const n = byId.get(string(id, 'id', 200));
      if (!n) continue;
      n.close();
      live.delete(n);
      byId.delete(id as string);
    }
  },
  async addressed(_sender, value) {
    const s = record(value, 'signal');
    closeAddressed({ threadId: string(s.threadId, 'threadId', 256), isViewed: s.isViewed === true, isActedOn: s.isActedOn === true });
  },
  async watch(_sender, value) {
    watch.set(watchConfig(value));
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

function watchConfig(value: unknown): WatchConfig {
  const c = record(value, 'config');
  const quiet = record(c.quiet, 'config.quiet');
  return {
    threads: list(c.threads, 'config.threads').map((v) => {
      const t = record(v, 'thread');
      return {
        id: string(t.id, 'thread.id', 256),
        title: string(t.title, 'thread.title', 500),
        cwd: t.cwd === undefined ? undefined : string(t.cwd, 'thread.cwd'),
        githubUser: t.githubUser === undefined ? undefined : string(t.githubUser, 'thread.githubUser', 128),
      };
    }),
    kinds: list(c.kinds, 'config.kinds').map((k) => string(k, 'kind', 64)),
    quiet: { isOn: quiet.isOn === true, start: integer(quiet.start, 'quiet.start', 0, 23), end: integer(quiet.end, 'quiet.end', 0, 23) },
    muted: list(c.muted, 'config.muted').map((id) => string(id, 'muted', 256)),
    needsYou: list(c.needsYou, 'config.needsYou').map((id) => string(id, 'needsYou', 256)),
    dockBadge: c.dockBadge === true,
  };
}

function list(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length > 10_000) throw new TypeError(`${name} must be an array`);
  return value as unknown[];
}
