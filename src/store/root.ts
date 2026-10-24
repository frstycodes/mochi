import { project } from '@mochi/domain';
import { showsDemoData } from '../demoData.ts';
import { applyUndo } from '../runtime/undo.ts';
import { initialNotifications, notificationsReducer } from '../notify/slice.ts';
import { initialLayout, layoutReducer } from './layout.ts';
import { initialPanes, panesReducer } from './panes.ts';
import { toSaved, type Saved } from './saved.ts';
import { initialQueue } from './queue.ts';
import { initialSideChat, sidechatReducer } from './sidechat.ts';
import { initialThreads } from './threads.ts';
import type { Action, State } from './types.ts';
import { initialUi, uiReducer } from './ui.ts';

/** This window's own slices, after the projection: another window's command (its new thread opening) leaves them be. */
const WINDOW_SLICES = [panesReducer, layoutReducer, uiReducer, sidechatReducer];

/** The demo's fixtures when shown, then `saved`: the threads Core holds. */
export function initialState(saved: Saved | null, isDemo = showsDemoData()): State {
  return { ...initialThreads(saved, isDemo), ...initialQueue(saved, isDemo), ...initialPanes(), ...initialLayout(), ...initialUi(), ...initialSideChat(), ...initialNotifications() };
}

/** Another computer's store as a device mirrors it (`src/remote/mirror.ts`): its saved threads, nothing of this computer's own. */
export function mirrorState(saved: Saved): State {
  return { ...initialThreads(saved, false), ...initialQueue(saved, false), ...initialPanes([]), ...initialLayout({ layouts: {}, watched: [] }), ...initialUi(), ...initialSideChat({}), ...initialNotifications() };
}

export interface Fold {
  /** When Core logged the action: what the folds stamp as wall clock (`wallNow`). */
  ms?: number;
  /** Another window's command. */
  isForeign?: boolean;
}

export function reducer(state: State, action: Action, { ms, isForeign }: Fold = {}): State {
  if (action.type === 'tool-undo') return applyUndo(state, action.undo).state;
  // Resetting the demo keeps your own threads as they are.
  if (action.type === 'reset') return { ...initialState(toSaved(state)), ...initialPanes([]), ...initialLayout({ layouts: {}, watched: [] }), ...initialSideChat({}) };
  const projected = project(state, action, ms);
  const windowed = isForeign ? projected : WINDOW_SLICES.reduce((s, slice) => slice(s, action), projected);
  // It diffs what the others changed, so it runs last.
  return notificationsReducer(windowed, action);
}
