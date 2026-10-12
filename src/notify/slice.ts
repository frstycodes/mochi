import type { QueueItem, Thread } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { diffNotices, type Notice, type QuietHours } from './model.ts';

export interface NotificationsState {
  notifications: {
    items: Notice[];
    /** What the last diff ran against: the slice compares it with the current threads and queue instead of needing the previous state. */
    seen: { threads: Thread[]; queue: QueueItem[] } | null;
    muted: string[];
    quiet: QuietHours;
  };
}

export type NotificationsAction =
  | { type: 'notify-read'; ids?: string[] }
  | { type: 'notify-clear' }
  | { type: 'notify-mute'; threadId: string }
  | { type: 'notify-quiet'; quiet: QuietHours };

const STORAGE_KEY = 'harness:notify-settings';
const MAX_ITEMS = 200;

export function initialNotifications(): NotificationsState {
  return { notifications: { items: [], seen: null, ...loadSettings() } };
}

export function notificationsReducer(state: State, action: Action): State {
  const n = state.notifications;
  switch (action.type) {
    case 'notify-read':
      return withNotifications(state, { items: n.items.map((i) => (!action.ids || action.ids.includes(i.id) ? { ...i, isRead: true } : i)) });
    case 'notify-clear':
      return withNotifications(state, { items: [] });
    case 'notify-mute': {
      const muted = n.muted.includes(action.threadId) ? n.muted.filter((id) => id !== action.threadId) : [...n.muted, action.threadId];
      return withNotifications(state, { muted });
    }
    case 'notify-quiet':
      return withNotifications(state, { quiet: action.quiet });
    case 'delete':
      return withNotifications(state, { items: n.items.filter((i) => !action.threadIds.includes(i.threadId)), seen: { threads: state.threads, queue: state.queue } });
  }
  if (state.threads === n.seen?.threads && state.queue === n.seen.queue) return state;
  const seen = { threads: state.threads, queue: state.queue };
  // First action after load sets the baseline; an undo jumps back in time, so diffing across it would announce events that already happened.
  if (!n.seen || action.type === 'restore') return withNotifications(state, { seen });
  const fresh = diffNotices(n.seen, seen, state.now).filter((x) => !n.muted.includes(x.threadId));
  return withNotifications(state, { seen, items: fresh.length ? [...fresh.reverse(), ...n.items].slice(0, MAX_ITEMS) : n.items });
}

function withNotifications(state: State, patch: Partial<NotificationsState['notifications']>): State {
  return { ...state, notifications: { ...state.notifications, ...patch } };
}

export function saveNotifySettings({ muted, quiet }: { muted: string[]; quiet: QuietHours }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted, quiet }));
  } catch {
    // Storage blocked (private window, artifact sandbox): settings just don't persist.
  }
}

function loadSettings(): { muted: string[]; quiet: QuietHours } {
  const fallback = { muted: [], quiet: { isOn: false, start: 22, end: 8 } };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
