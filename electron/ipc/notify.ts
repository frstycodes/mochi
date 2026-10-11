import { Notification } from 'electron';
import type { NotifyHost } from '../../src/host/types/notify.ts';
import { record, string, type Handlers } from './handlers.ts';

export const notify = {
  async show(_sender, notice) {
    const { title, body } = record(notice, 'notice');
    new Notification({ title: string(title, 'title', 200), body: body === undefined ? undefined : string(body, 'body', 2000) }).show();
  },
} satisfies Handlers<NotifyHost>;
