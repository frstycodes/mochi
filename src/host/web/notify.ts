import type { NotifyHost, NotifyPermission } from '../types/notify.ts';

const listeners = new Set<(id: string) => void>();
const permission = (): NotifyPermission => (typeof Notification === 'undefined' ? 'denied' : Notification.permission);

export const notify: NotifyHost = {
  async show({ title, body, id }) {
    if (permission() !== 'granted') return;
    const n = new Notification(title, { body, tag: id });
    n.onclick = () => {
      window.focus();
      n.close();
      if (id) for (const l of listeners) l(id);
    };
  },
  // GAP: the web build has no main process to watch threads or poll CI, and no dock badge (`navigator.setAppBadge` is PWA-only).
  async watch() {},
  async pendingOpen() {
    return null;
  },
  async permission() {
    return permission();
  },
  async requestPermission() {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.requestPermission();
  },
  onClick(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  onOpenThread() {
    return () => {};
  },
  async haptic() {
    // Touch only: a desktop browser has no trackpad haptics to reach.
    if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(6);
  },
};
