import type { NotifyHost } from '../types/notify.ts';

export const notify: NotifyHost = {
  async show({ title, body }) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body });
  },
};
