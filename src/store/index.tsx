import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import { setDriftClassifier } from '../drift.ts';
import { host } from '../host/index.ts';
import type { AgentEvent } from '../host/types/agent.ts';
import type { QueueItem, Thread } from '../model.ts';
import { useProfiles } from '../profiles.ts';
import { resolution } from '../runtime/apply.ts';
import { agentCalls, type AgentCall } from '../runtime/live.ts';
import { initialLayout, layoutReducer, type LayoutAction, type LayoutState } from './layout.ts';
import { initialPanes, panesReducer, savePanes, type PanesAction, type PanesState } from './panes.ts';
import { initialQueue, queueReducer, rankQueue, type QueueAction, type QueueState } from './queue.ts';
import { initialSideChat, saveSideChats, sidechatReducer, type SideChatAction, type SideChatState } from './sidechat.ts';
import { getRestored, saveThreads, toSaved } from './persist.ts';
import { initialThreads, threadsReducer, type ThreadsAction, type ThreadsState } from './threads.ts';
import { initialUi, uiReducer, type UiAction, type UiState } from './ui.ts';
import { initialNotifications, notificationsReducer, type NotificationsAction, type NotificationsState } from '../notify/slice.ts';

export type { View } from './layout.ts';
export type { OverlapMode } from './threads.ts';
export { rankQueue };

export interface Snapshot {
  threads: Thread[];
  queue: QueueItem[];
}

export type State = ThreadsState & QueueState & PanesState & LayoutState & UiState & SideChatState & NotificationsState;
export type Action = ThreadsAction | QueueAction | PanesAction | LayoutAction | UiAction | SideChatAction | NotificationsAction | { type: 'reset' };

// notificationsReducer diffs what the others changed, so it runs last.
const SLICES = [threadsReducer, queueReducer, panesReducer, layoutReducer, uiReducer, sidechatReducer, notificationsReducer];

function initialState(saved = getRestored()): State {
  return { ...initialThreads(saved), ...initialQueue(saved), ...initialPanes(), ...initialLayout(), ...initialUi(), ...initialSideChat(), ...initialNotifications() };
}

function reducer(state: State, action: Action): State {
  // Resetting the demo keeps your own threads as they are.
  if (action.type === 'reset') return { ...initialState(toSaved(state)), ...initialPanes([]), ...initialLayout({ layouts: {}, watched: [] }), ...initialSideChat({}) };
  return SLICES.reduce((s, slice) => slice(s, action), state);
}

setDriftClassifier((prompt, thread) => host.agent.classify(prompt, thread));

export const HarnessContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [state, apply] = useReducer(reducer, undefined, initialState);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const dispatch = useCallback<Dispatch<Action>>((action) => {
    const before = latest.current;
    const answer = resolution(before, action);
    if (answer) void host.agent.resolve(answer.requestId, answer.decision);
    for (const call of agentCalls(before, action, () => reducer(before, action))) {
      // A call that throws (bad options, no adapter) ends the turn as failed, so the thread says why instead of spinning.
      callAgent(call).catch((error: unknown) => apply({ type: 'agent', event: failed(call.threadId, error) }));
    }
    apply(action);
  }, []);
  // The tick is the demo adapter's clock; real agents report through host.agent whether or not the demo is paused.
  useEffect(() => {
    if (state.paused) return;
    const id = setInterval(() => apply({ type: 'tick' }), 1000);
    return () => clearInterval(id);
  }, [state.paused]);
  useEffect(() => host.agent.onEvent((event) => apply({ type: 'agent', event })), []);
  useEffect(() => {
    savePanes(state.panes);
  }, [state.panes]);
  useEffect(() => saveSideChats(state.sidechats), [state.sidechats]);
  useEffect(() => saveThreads(state), [state.threads, state.queue, state.checkpoints, state.forks]);
  return <HarnessContext.Provider value={{ state, dispatch }}>{children}</HarnessContext.Provider>;
}

// Sequential: a handoff's stop must reach the old agent before the new one starts in the same thread.
let pending: Promise<unknown> = Promise.resolve();

function callAgent(call: AgentCall) {
  const run = () => {
    if (call.method === 'start') return host.agent.start(call.threadId, call.options);
    if (call.method === 'send') return host.agent.send(call.threadId, call.text);
    return host.agent[call.method](call.threadId);
  };
  const next = pending.then(run);
  pending = next.catch(() => {});
  return next;
}

function failed(threadId: string, error: unknown): AgentEvent {
  return { threadId, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) };
}

export function useHarness() {
  const ctx = useContext(HarnessContext);
  if (!ctx) throw new Error('useHarness must be used inside HarnessProvider');
  return ctx;
}

const NEW_VIEW = { kind: 'new' } as const;

export function useSpace() {
  const { state } = useHarness();
  const profiles = useProfiles();
  return profiles.find((p) => p.id === state.spaceId) ?? profiles[0];
}

export function useView(spaceId?: string) {
  const { state } = useHarness();
  // A profile added in Settings gets its layout on first visit; until then it shows a new thread.
  return state.views[spaceId ?? state.spaceId] ?? NEW_VIEW;
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
