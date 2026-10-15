import type { QuietHours } from '../../notify/model.ts';
import type { Manifest } from './manifest.ts';

export interface Notice {
  title: string;
  body?: string;
  /** Handed back to `onClick` listeners when the user clicks the notification. */
  id?: string;
}

export interface WatchedThread {
  id: string;
  title: string;
  /** Where gh finds the thread's PR; unset for a folderless chat, which has no CI to poll. */
  cwd?: string;
  githubUser?: string;
}

/** What main needs to alert for watched threads while no window is in front, or none is open. The renderer resends it on every change. */
export interface WatchConfig {
  threads: WatchedThread[];
  /** Settings › Notifications › System alerts. */
  kinds: string[];
  quiet: QuietHours;
  muted: string[];
  /** Threads waiting on you, for the dock badge. */
  needsYou: string[];
  dockBadge: boolean;
}

/** You looked at or acted in a thread: main closes the watched-thread notifications that settles (`isAddressed`). */
export interface ThreadAddressed {
  threadId: string;
  isViewed?: boolean;
  isActedOn?: boolean;
}

export type NotifyPermission = 'granted' | 'denied' | 'default';

export interface NotifyHost {
  show(notice: Notice): Promise<void>;
  /** Takes down notifications `show` put up, by their `id`; ones already gone are skipped. */
  close(ids: string[]): Promise<void>;
  addressed(signal: ThreadAddressed): Promise<void>;
  /** Main owns watched-thread OS notifications, CI polling and the dock badge, so they keep working with every window closed. */
  watch(config: WatchConfig): Promise<void>;
  /** The thread a notification click asked for before this window was ready to hear it; returns it once. */
  pendingOpen(): Promise<string | null>;
  permission(): Promise<NotifyPermission>;
  /** Browsers only grant from a user gesture: call it from a click handler. */
  requestPermission(): Promise<NotifyPermission>;
  /** Fires after a click on a notification that carried an `id`, once the app window is focused. */
  onClick(listener: (id: string) => void): () => void;
  /** A click on a watched-thread notification: open that thread. */
  onOpenThread(listener: (threadId: string) => void): () => void;
  /** One haptic tick on a Mac's Force Touch trackpad; a no-op where there's none. */
  haptic(): Promise<void>;
}

export const notifyMethods = {
  show: 'invoke',
  close: 'invoke',
  addressed: 'invoke',
  watch: 'invoke',
  pendingOpen: 'invoke',
  permission: 'invoke',
  requestPermission: 'invoke',
  onClick: 'event',
  onOpenThread: 'event',
  haptic: 'invoke',
} satisfies Manifest<NotifyHost>;
