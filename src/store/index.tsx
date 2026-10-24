import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type ReactNode } from 'react';
import { setDriftClassifier } from '../drift.ts';
import { host } from '../host/index.ts';
import { showsDemoData } from '../demoData.ts';
import { NO_AGENT_PROCESS, type AgentEvent, type AgentToolCall, type AttachedAgent, type SeqAgentEvent } from '../host/types/agent.ts';
import { isListed, type QueueItem, type Thread } from '../model.ts';
import { isSameListing } from '../reorder.ts';
import { useProfiles } from '../profiles.ts';
import { resolution, undelivered } from '../runtime/apply.ts';
import { setWorktreePath } from '../git/worktrees.ts';
import { agentCalls, resumeAfterLostProcess, unsentTurns, type AgentCall } from '../runtime/live.ts';
import { runTool } from '../runtime/tools.ts';
import { runDevTool } from '../runtime/devTools.ts';
import { toolEnv } from '../runtime/toolEnv.ts';
import type { ToolUndo } from '../runtime/undo.ts';
import type { LayoutAction, LayoutState } from './layout.ts';
import { savePanes, type PanesAction, type PanesState } from './panes.ts';
import { rankQueue, type QueueAction, type QueueState } from './queue.ts';
import { saveSideChats, type SideChatAction, type SideChatState } from './sidechat.ts';
import { saveThreads } from './persist.ts';
import { createExternalState, fixedStore, shallowEqual, type HarnessStore } from './external.ts';
import { initialState, reducer } from './root.ts';
import type { ThreadsAction, ThreadsState } from './threads.ts';
import type { UiAction, UiState } from './ui.ts';
import type { ReviewAction } from '../secondOpinion/slice.ts';
import { actedOn, type NotificationsAction, type NotificationsState } from '../notify/slice.ts';
import { scheduleCalls, triggerInput } from '../schedule/calls.ts';
import type { ScheduleAction } from '../schedule/slice.ts';
import type { ScheduleEvent } from '../host/types/schedule.ts';
import { recordAction } from '../replay/recorder.ts';
import { tapAction } from '../remote/tap.ts';
import { classifyInCore } from '../utility/runUtility.ts';
import { WindowReactor } from '../reactor/WindowReactor.tsx';

export type { View } from './layout.ts';
export { rankQueue };
export { mirrorState, reducer } from './root.ts';
export { shallowEqual } from './external.ts';

export interface Snapshot {
  threads: Thread[];
  queue: QueueItem[];
}

/** `streamed`: how many of the remote stream's numbered actions this store holds (`src/remote/tap.ts`). */
export type State = ThreadsState & QueueState & PanesState & LayoutState & UiState & SideChatState & NotificationsState & { streamed: number };
export type Action = ThreadsAction | QueueAction | PanesAction | LayoutAction | UiAction | SideChatAction | ReviewAction | NotificationsAction | ScheduleAction | { type: 'reset' } | { type: 'tool-undo'; undo: ToolUndo };

setDriftClassifier(classifyInCore);

const TICK_MS = showsDemoData() ? 1000 : 60_000;

const HarnessContext = createContext<HarnessStore<State, Action> | null>(null);

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [external] = useState(() => createExternalState(initialState()));
  const state = useSyncExternalStore(external.subscribe, external.getState);
  const applyNow = useCallback((action: Action) => external.set(reducer(external.getState(), action)), [external]);
  const apply = useCallback((action: Action) => {
    recordAction(external.getState(), action);
    applyNow(action);
  }, [applyNow]);
  const dispatch = useCallback<Dispatch<Action>>((action) => {
    const before = external.getState();
    recordAction(before, action);
    const answer = resolution(before, action);
    if (answer) host.agent.resolve(answer.requestId, answer.decision).catch((error: unknown) => apply({ type: 'say', threadId: answer.threadId, entry: undelivered(answer, error) }));
    let after: State | undefined;
    const next = () => (after ??= reducer(before, action));
    const calls = agentCalls(before, action, next);
    for (const input of scheduleCalls(before, action, next)) host.schedule.set(input).catch((error: unknown) => console.error('Saving the schedule failed', error));
    // A deleted thread takes its trigger with it.
    if (action.type === 'delete') for (const id of action.threadIds) host.schedule.remove(id).catch((error: unknown) => console.error('Removing the schedule failed', error));
    for (const call of calls) {
      // A call that throws (bad options, no adapter) ends the turn as failed, so the thread says why instead of spinning.
      callAgent(call).catch((error: unknown) => {
        const thread = call.method === 'send' && isLostProcess(error) ? external.getState().threads.find((t) => t.id === call.threadId) : undefined;
        const retry = thread && call.method === 'send' ? resumeAfterLostProcess(thread, call) : [];
        if (retry.length === 0) return apply({ type: 'agent', event: failed(call.threadId, error) });
        for (const again of retry) {
          if (again.method === 'start') applyNow({ type: 'agent-starting', threadId: again.threadId, provider: again.options.provider });
          callAgent(again).catch((e: unknown) => apply({ type: 'agent', event: failed(again.threadId, e) }));
        }
      });
    }
    applyNow(action);
    for (const threadId of unsentTurns(before, next(), calls)) apply({ type: 'agent', event: failed(threadId, new Error('Mochi had no agent to send this to')) });
    // After the action: a new thread only exists once it has applied.
    for (const call of calls) if (call.method === 'start') applyNow({ type: 'agent-starting', threadId: call.threadId, provider: call.options.provider });
    if (action.type === 'workspace') void retarget(next().threads.find((t) => t.id === action.threadId));
    const acted = actedOn(action, before.queue);
    if (acted) host.notify.addressed({ threadId: acted, isActedOn: true }).catch(() => undefined);
  }, [external, apply, applyNow]);
  // The tick is the app's clock, one per minute of `now`: the demo runs it 60× fast, real threads at wall-clock speed.
  // Real agents report through host.agent whether or not the demo is paused.
  useEffect(() => {
    if (state.paused) return;
    // Streamed but not recorded for replay: a device's copy keeps the same clock, so entries it applies get the same times.
    const id = setInterval(() => {
      const tick: Action = { type: 'tick' };
      tapAction(tick);
      applyNow(tick);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.paused, applyNow]);
  useEffect(() => {
    // Each event folds into the state as it arrives, in order; components hear about a burst once a frame (`defer`).
    const onEvent = (event: SeqAgentEvent) => {
      if (event.type === 'worktree') setWorktreePath(event.threadId, event.path);
      const action: Action = { type: 'agent', event, ms: Date.now() };
      recordAction(external.getState(), action);
      external.defer(reducer(external.getState(), action));
    };
    // After a window reload, agents still running in main replay what they sent meanwhile; live events wait behind that replay.
    let held: SeqAgentEvent[] | null = [];
    const off = host.agent.onEvent((event) => (held ? held.push(event) : onEvent(event)));
    const attached = external.getState().threads.filter((t) => t.live && !t.live.isDetached).map((t) => ({ threadId: t.id, after: t.live!.eventSeq ?? 0 }));
    void (attached.length ? host.agent.attached(attached) : Promise.resolve([]))
      .catch((error: unknown): AttachedAgent[] => (console.error('Replaying agent events after reload failed', error), []))
      .then((agents) => {
        const seen = new Set<number>();
        [...agents.flatMap((a) => a.events), ...held!]
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
          .forEach((event) => {
            if (event.seq !== undefined && seen.has(event.seq)) return;
            if (event.seq !== undefined) seen.add(event.seq);
            onEvent(event);
          });
        held = null;
      });
    return off;
  }, [external]);
  useEffect(() => {
    const onSchedule = (event: ScheduleEvent) => {
      if (event.type === 'agent') return apply({ type: 'agent', event: event.event });
      // Dispatched, not applied: the message it becomes must reach the agent (`agentCalls`).
      if (event.type === 'autofix') return dispatch({ type: 'autofix', threadId: event.threadId, event: event.event });
      apply(event.type === 'ci' ? { type: 'ci-result', event } : { type: 'schedule-run', event });
    };
    const off = host.schedule.onEvent(onSchedule);
    // What happened while no window was open: runs and their agent's events, in order.
    void host.schedule.drain().then((events) => events.forEach(onSchedule), (error: unknown) => console.error('Reading scheduled runs failed', error));
    return off;
  }, [apply, dispatch]);
  useEffect(() => {
    const onToolCall = (call: AgentToolCall) => {
      const env = toolEnv(external.getState, dispatch);
      void (import.meta.env.DEV && call.threadId === '__dev__' ? runDevTool(call, env) : runTool(call, env)).then((result) => host.agent.toolResult(call.id, result));
    };
    const off = host.agent.onToolCall(onToolCall);
    // Asked only once listening, so a call main sends meanwhile arrives once, by one route or the other.
    void host.agent.pendingToolCalls().then((calls) => calls.forEach(onToolCall), (error: unknown) => console.error('Taking back tool calls after reload failed', error));
    return off;
  }, [external, dispatch]);
  useEffect(() => {
    savePanes(state.panes);
  }, [state.panes]);
  useEffect(() => saveSideChats(state.sidechats), [state.sidechats]);
  useEffect(() => saveThreads(state), [state.threads, state.queue, state.checkpoints, state.forks]);
  const store = useMemo(() => ({ getState: external.getState, subscribe: external.subscribe, dispatch }), [external, dispatch]);
  return (
    <HarnessContext.Provider value={store}>
      <WindowReactor />
      {children}
    </HarnessContext.Provider>
  );
}

/** Hands its children a store React already holds: a mirrored window, another computer's threads, a replay. */
export function HarnessScope({ state, dispatch, children }: { state: State; dispatch: Dispatch<Action>; children: ReactNode }) {
  const store = useMemo(() => fixedStore(state, dispatch), [state, dispatch]);
  return <HarnessContext.Provider value={store}>{children}</HarnessContext.Provider>;
}

// Sequential: a handoff's stop must reach the old agent before the new one starts in the same thread.
let pending: Promise<unknown> = Promise.resolve();

function callAgent(call: AgentCall) {
  const run = () => {
    if (call.method === 'start') return host.agent.start(call.threadId, call.options);
    if (call.method === 'send') return host.agent.send(call.threadId, call.text, call.images, call.skills, call.speed, call.steer, call.steerId);
    if (call.method === 'compact') return host.agent.compact(call.threadId, call.focus);
    if (call.method === 'stopTask') return host.agent.stopTask(call.threadId, call.taskId);
    return host.agent[call.method](call.threadId);
  };
  const next = pending.then(run);
  pending = next.catch(() => {});
  return next;
}

function isLostProcess(error: unknown) {
  return error instanceof Error && error.message.includes(NO_AGENT_PROCESS);
}

function failed(threadId: string, error: unknown): AgentEvent {
  return { threadId, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) };
}

function useHarnessStore() {
  const store = useContext(HarnessContext);
  if (!store) throw new Error('useHarness must be used inside HarnessProvider');
  return store;
}

/** The whole state: re-renders on every change, agent tokens included. Prefer `useHarnessSelector` for what a component shows. */
export function useHarness() {
  const store = useHarnessStore();
  return { state: useSyncExternalStore(store.subscribe, store.getState), dispatch: store.dispatch };
}

export function useDispatch() {
  return useHarnessStore().dispatch;
}

/** The newest state, read when called (an event handler, a drag), without re-rendering on changes. */
export function useGetState() {
  return useHarnessStore().getState;
}

/** What `select` picks from the state; re-renders only when that changes by `isEqual` (`shallowEqual` for a picked object or list). */
export function useHarnessSelector<T>(select: (state: State) => T, isEqual: (a: T, b: T) => boolean = Object.is) {
  const store = useHarnessStore();
  return useSyncExternalStoreWithSelector(store.subscribe, store.getState, null, select, isEqual);
}

const NEW_VIEW = { kind: 'new' } as const;

export function useSpace() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const profiles = useProfiles();
  return profiles.find((p) => p.id === spaceId) ?? profiles[0];
}

export function useView(spaceId?: string) {
  // A profile added in Settings gets its layout on first visit; until then it shows a new thread.
  return useHarnessSelector((s) => s.views[spaceId ?? s.spaceId] ?? NEW_VIEW);
}

export function useThread(id: string) {
  return useHarnessSelector((s) => s.threads.find((t) => t.id === id));
}

export function useSpaceThreads(spaceId?: string) {
  return useHarnessSelector((s) => s.threads.filter((t) => t.spaceId === (spaceId ?? s.spaceId) && isListed(t)), shallowEqual);
}

/** The space's threads to list them (`isSameListing`): stale in what a turn streams, so each row reads its own thread for that. */
export function useSpaceListing(spaceId: string) {
  return useHarnessSelector((s) => s.threads.filter((t) => t.spaceId === spaceId && isListed(t)), isSameListing);
}

export function useSpaceQueue(spaceId?: string) {
  return useHarnessSelector((s) => {
    const id = spaceId ?? s.spaceId;
    const ids = new Set(s.threads.filter((t) => t.spaceId === id && isListed(t)).map((t) => t.id));
    return rankQueue(s.queue.filter((q) => ids.has(q.threadId)));
  }, shallowEqual);
}

export function snapshot(state: State): Snapshot {
  return { threads: state.threads, queue: state.queue };
}

/** A scheduled thread's trigger keeps how main starts it; a new workspace before its first run replaces that. */
async function retarget(thread: Thread | undefined) {
  if (!thread) return;
  const trigger = (await host.schedule.list()).find((t) => t.threadId === thread.id);
  const input = trigger && triggerInput(thread, { when: trigger.when, missed: trigger.missed, name: trigger.name, prompt: trigger.prompt });
  if (input) await host.schedule.set(input).catch((error: unknown) => console.error('Saving the schedule failed', error));
}
