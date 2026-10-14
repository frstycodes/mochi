import { isTapped } from '../remote/tap.ts';
import { applyUndo } from '../runtime/undo.ts';
import { reviewsReducer } from '../secondOpinion/slice.ts';
import { initialNotifications, notificationsReducer } from '../notify/slice.ts';
import { scheduleReducer } from '../schedule/slice.ts';
import type { Action, State } from './index.tsx';
import { initialLayout, layoutReducer } from './layout.ts';
import { initialPanes, panesReducer } from './panes.ts';
import { getRestored, toSaved, type Saved } from './persist.ts';
import { initialQueue, queueReducer } from './queue.ts';
import { initialSideChat, sidechatReducer } from './sidechat.ts';
import { initialThreads, threadsReducer } from './threads.ts';
import { initialUi, uiReducer } from './ui.ts';

// notificationsReducer diffs what the others changed, so it runs last.
const SLICES = [threadsReducer, queueReducer, panesReducer, layoutReducer, uiReducer, sidechatReducer, reviewsReducer, scheduleReducer, notificationsReducer];

export function initialState(saved = getRestored()): State {
  return { ...initialThreads(saved), ...initialQueue(saved), ...initialPanes(), ...initialLayout(), ...initialUi(), ...initialSideChat(), ...initialNotifications(), streamed: 0 };
}

/** Another computer's store as a device mirrors it (`src/remote/mirror.ts`): its saved threads, nothing of this computer's own. */
export function mirrorState(saved: Saved): State {
  return { ...initialThreads(saved, false), ...initialQueue(saved, false), ...initialPanes([]), ...initialLayout({ layouts: {}, watched: [] }), ...initialUi(), ...initialSideChat({}), ...initialNotifications(), streamed: 0 };
}

export function reducer(state: State, action: Action): State {
  return { ...reduce(state, action), streamed: state.streamed + (isTapped(action) ? 1 : 0) };
}

function reduce(state: State, action: Action): State {
  // Resetting the demo keeps your own threads as they are.
  if (action.type === 'tool-undo') return applyUndo(state, action.undo).state;
  if (action.type === 'reset') return { ...initialState(toSaved(state)), ...initialPanes([]), ...initialLayout({ layouts: {}, watched: [] }), ...initialSideChat({}) };
  return SLICES.reduce((s, slice) => slice(s, action), state);
}

