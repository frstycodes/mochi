import { persistedSlice } from '../lib/uiStorage.ts';
import type { QueueItem, Thread } from '../model.ts';
import type { Action, State } from '../store/types.ts';
import { diffNotices, isAddressed, type Addressing, type Notice, type QuietHours } from './model.ts';

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
  | { type: 'notify-quiet'; quiet: QuietHours }
  /** The thread is on screen in a focused window: notices that looking settles leave. */
  | { type: 'notify-viewed'; threadId: string };

const STORAGE_KEY = 'harness:notify-settings';
const notifyDefaults = { muted: [], quiet: { isOn: false, start: 22, end: 8 } };
const storageSlice = persistedSlice<{ muted: string[]; quiet: QuietHours }>(STORAGE_KEY, notifyDefaults, (raw) => ({ ...notifyDefaults, ...JSON.parse(raw ?? '{}') }));
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
    case 'notify-viewed':
      return withNotifications(state, { items: dropAddressed(state, n.items, action.threadId, { isViewed: true }) });
    case 'delete':
      return withNotifications(state, { items: n.items.filter((i) => !action.threadIds.includes(i.threadId)), seen: { threads: state.threads, queue: state.queue } });
  }
  if (state.threads === n.seen?.threads && state.queue === n.seen.queue) return state;
  const seen = { threads: state.threads, queue: state.queue };
  // First action after load sets the baseline; an undo jumps back in time, so diffing across it would announce events that already happened.
  if (!n.seen || action.type === 'restore') return withNotifications(state, { seen });
  const fresh = diffNotices(n.seen, seen, state.now).filter((x) => !n.muted.includes(x.threadId));
  // Only notices from before this action: one it raised hasn't had a chance to be acted on yet.
  const kept = dropAddressed(state, n.items, actedOn(action, n.seen.queue));
  return withNotifications(state, { seen, items: fresh.length ? [...fresh.reverse(), ...kept].slice(0, MAX_ITEMS) : kept });
}

/** The thread you acted in with this action, which settles its notices that wait on you; automatic sends and resumes don't count. */
export function actedOn(action: Action, queue: QueueItem[]): string | undefined {
  switch (action.type) {
    case 'send':
      return action.from ? undefined : action.threadId;
    case 'resume':
      return action.atReset ? undefined : action.threadId;
    case 'answer':
      return queue.find((q) => q.id === action.queueId)?.threadId;
    case 'interrupt':
    case 'compact':
    case 'settle':
    case 'rewind':
    case 'rewind-message':
    case 'turn-undo':
    case 'handoff':
      return action.threadId;
  }
}

/** Drops what's addressed by where each thread now stands, plus `signal` for `threadId`'s notices. Same array when nothing goes. */
function dropAddressed(state: State, items: Notice[], threadId: string | undefined, signal: Omit<Addressing, 'thread' | 'queue'> = { isActedOn: true }): Notice[] {
  const threads = new Map(state.threads.map((t) => [t.id, t]));
  const kept = items.filter((i) => !isAddressed(i, { ...(i.threadId === threadId && signal), thread: threads.get(i.threadId), queue: state.queue }));
  return kept.length === items.length ? items : kept;
}

function withNotifications(state: State, patch: Partial<NotificationsState['notifications']>): State {
  return { ...state, notifications: { ...state.notifications, ...patch } };
}

export function saveNotifySettings({ muted, quiet }: { muted: string[]; quiet: QuietHours }) {
  storageSlice.setState({ value: { muted, quiet } });
}

function loadSettings(): { muted: string[]; quiet: QuietHours } {
  return storageSlice.getState().value;
}
