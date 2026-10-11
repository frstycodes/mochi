import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { SPACES, type QueueItem, type Thread } from '../model.ts';
import { initialLayout, layoutReducer, type LayoutAction, type LayoutState } from './layout.ts';
import { initialPanes, panesReducer, savePanes, type PanesAction, type PanesState } from './panes.ts';
import { initialQueue, queueReducer, rankQueue, type QueueAction, type QueueState } from './queue.ts';
import { initialThreads, threadsReducer, type ThreadsAction, type ThreadsState } from './threads.ts';
import { initialUi, uiReducer, type UiAction, type UiState } from './ui.ts';

export type { View } from './layout.ts';
export type { OverlapMode } from './threads.ts';
export { rankQueue };

export interface Snapshot {
  threads: Thread[];
  queue: QueueItem[];
}

export type State = ThreadsState & QueueState & PanesState & LayoutState & UiState;
export type Action = ThreadsAction | QueueAction | PanesAction | LayoutAction | UiAction | { type: 'reset' };

const SLICES = [threadsReducer, queueReducer, panesReducer, layoutReducer, uiReducer];

function initialState(): State {
  return { ...initialThreads(), ...initialQueue(), ...initialPanes(), ...initialLayout(), ...initialUi() };
}

function reducer(state: State, action: Action): State {
  if (action.type === 'reset') return { ...initialState(), ...initialPanes([]), ...initialLayout({ layouts: {}, watched: [] }) };
  return SLICES.reduce((s, slice) => slice(s, action), state);
}

const HarnessContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffect(() => {
    if (state.paused) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(id);
  }, [state.paused]);
  useEffect(() => {
    savePanes(state.panes);
  }, [state.panes]);
  return <HarnessContext.Provider value={{ state, dispatch }}>{children}</HarnessContext.Provider>;
}

export function useHarness() {
  const ctx = useContext(HarnessContext);
  if (!ctx) throw new Error('useHarness must be used inside HarnessProvider');
  return ctx;
}

export function useSpace() {
  const { state } = useHarness();
  return SPACES.find((s) => s.id === state.spaceId)!;
}

export function useView(spaceId?: string) {
  const { state } = useHarness();
  return state.views[spaceId ?? state.spaceId];
}

export function useThread(id: string) {
  const { state } = useHarness();
  return state.threads.find((t) => t.id === id);
}

export function useSpaceThreads(spaceId?: string) {
  const { state } = useHarness();
  const id = spaceId ?? state.spaceId;
  return state.threads.filter((t) => t.spaceId === id);
}

export function useSpaceQueue(spaceId?: string) {
  const { state } = useHarness();
  const id = spaceId ?? state.spaceId;
  const ids = new Set(state.threads.filter((t) => t.spaceId === id).map((t) => t.id));
  return rankQueue(state.queue.filter((q) => ids.has(q.threadId)));
}

export function snapshot(state: State): Snapshot {
  return { threads: state.threads, queue: state.queue };
}
