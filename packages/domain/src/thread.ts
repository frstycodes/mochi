import type { LoggedEvent } from './shell.ts';

/**
 * One thread as a client holds it: the latest saved snapshot (a `SavedThread`, or null before the first save) and the
 * events logged after it, which the renderer's reducer applies on top.
 */
export interface ThreadView {
  readonly sequence: number;
  readonly saved: unknown;
  readonly events: ReadonlyArray<LoggedEvent>;
}

export type ThreadItem = { readonly _tag: 'snapshot'; readonly sequence: number; readonly saved: unknown } | { readonly _tag: 'event'; readonly event: LoggedEvent };

export const emptyThread: ThreadView = { sequence: 0, saved: null, events: [] };

/** Folds one `thread` stream item; a snapshot drops the events it already contains. */
export function projectThread(view: ThreadView, item: ThreadItem): ThreadView {
  if (item._tag === 'snapshot') return item.sequence >= view.sequence ? { sequence: item.sequence, saved: item.saved, events: [] } : view;
  if (item.event.sequence <= view.sequence) return view;
  return { ...view, sequence: item.event.sequence, events: [...view.events, item.event] };
}

/** Bounds of a replay; past either, `thread` sends a snapshot instead (T3 Code's limits). */
export const MAX_REPLAY_EVENTS = 128;
export const MAX_REPLAY_BYTES = 1024 * 1024;
