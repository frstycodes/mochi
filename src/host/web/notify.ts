import type { NotifyHost, NotifyPermission } from '../types/notify.ts';

const listeners = new Set<(id: string) => void>();
const permission = (): NotifyPermission => (typeof Notification === 'undefined' ? 'denied' : Notification.permission);

// GAP: browsers have no dock badge; `navigator.setAppBadge` only works for installed PWAs, which the web build isn't.
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
  async setBadge() {},
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
  async haptic() {
    // Touch only: a desktop browser has no trackpad haptics to reach.
    if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(6);
  },
};
