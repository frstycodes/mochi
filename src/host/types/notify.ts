import type { Manifest } from './manifest.ts';

export interface Notice {
  title: string;
  body?: string;
  /** Handed back to `onClick` listeners when the user clicks the notification. */
  id?: string;
}

export type NotifyPermission = 'granted' | 'denied' | 'default';

export interface NotifyHost {
  show(notice: Notice): Promise<void>;
  /** Dock badge count; 0 clears it. */
  setBadge(count: number): Promise<void>;
  permission(): Promise<NotifyPermission>;
  /** Browsers only grant from a user gesture: call it from a click handler. */
  requestPermission(): Promise<NotifyPermission>;
  /** Fires after a click on a notification that carried an `id`, once the app window is focused. */
  onClick(listener: (id: string) => void): () => void;
}

export const notifyMethods = {
  show: 'invoke',
  setBadge: 'invoke',
  permission: 'invoke',
  requestPermission: 'invoke',
  onClick: 'event',
} satisfies Manifest<NotifyHost>;
