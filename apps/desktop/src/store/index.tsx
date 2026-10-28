import { useStore } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import { replaceAllPins, useAllPins } from '../chat/pins.ts';
import { setDriftClassifier } from '../drift.ts';
import { host } from '../host/index.ts';
import { showsDemoData } from '../demoData.ts';
import { NO_AGENT_PROCESS, type AgentToolCall } from '../host/types/agent.ts';
import { isListed, type Thread } from '../model.ts';
import { isSameListing } from '../reorder.ts';
import { followProfiles, storedProfiles, useProfiles } from '../profiles.ts';
import { resolution, undelivered } from '../runtime/apply.ts';
import { setWorktreePath } from '../git/worktrees.ts';
import {
  agentCallArgs,
  agentCalls,
  resumeAfterLostProcess,
  unsentTurns,
  type AgentCall,
} from '../runtime/live.ts';
import { runTool } from '../runtime/tools.ts';
import { runDevTool } from '../runtime/devTools.ts';
import { toolEnv } from '../runtime/toolEnv.ts';
import { setPrefs, usePrefs } from '../settings/prefs.ts';
import {
  migratedContext,
  projectionPrefs,
  type ProjectionContext,
} from './context.ts';
import { savePanes } from './panes.ts';
import { rankQueue } from './queue.ts';
import { createReplica, type Replica } from './replica.ts';
import { coreLog, pageLog } from './replicaLog.ts';
import { saveSideChats } from './sidechat.ts';
import { shallow as shallowEqual } from 'zustand/vanilla/shallow';
import { initialState, reducer } from './root.ts';
import type { Action, Snapshot, State } from './types.ts';
import { actedOn } from '../notify/slice.ts';
import { scheduleCalls, triggerInput } from '../schedule/calls.ts';
import type { ScheduleEvent } from '../host/types/schedule.ts';
import { recordAction } from '../replay/recorder.ts';
import { markOwnAnswer } from '@mochi/domain/remote/answers';
import { classifyInCore } from '../utility/runUtility.ts';
import { WindowReactor } from '../reactor/WindowReactor.tsx';

export type { View } from './layout.ts';
export { rankQueue };
export { mirrorState, reducer } from './root.ts';
export { shallow as shallowEqual } from 'zustand/vanilla/shallow';

export type { Action, Snapshot, State } from './types.ts';

setDriftClassifier(classifyInCore);

/** One demo minute a second. */
const DEMO_TICK_MS = 1000;

/** The store as components read it: the zustand store, the newest state (own commands included), and the way to change it. */
interface HarnessStore {
  store: StoreApi<State>;
  getState: () => State;
  dispatch: Dispatch<Action>;
}

const HarnessContext = createContext<HarnessStore | null>(null);

let replica: Replica | undefined;

/** This window's store, once Core's first item is in; `src/main.tsx` waits for it before the first render. */
export async function startStore() {
  replica ??= await createReplica(
    host.hasCore ? coreLog() : pageLog(),
    (saved) => initialState(saved),
  );
  followProfiles(replica);
  replica.listen((action) => {
    if (action.type === 'agent' && action.event.type === 'worktree')
      setWorktreePath(action.event.threadId, action.event.path);
  });
}

function requireReplica() {
  if (!replica)
    throw new Error('The store starts before the first render (startStore)');
  return replica;
}

/** The main window's store: `StoreProvider`'s, plus the work only one window does (Mochi tool calls, scheduled runs). */
export function HarnessProvider({ children }: { children: ReactNode }) {
  const { replica, value, apply } = useStoreValue();
  const { dispatch } = value;
  const state = useStore(replica.store);
  // Agent events and other windows' commands, as they fold; this window's own are recorded as they are dispatched.
  useEffect(
    () => replica.listen((action, before) => recordAction(before, action)),
    [replica],
  );
  // The demo's clock runs 60× fast; real threads keep Core's, one tick a minute.
  useEffect(() => {
    if (state.paused || !showsDemoData()) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), DEMO_TICK_MS);
    return () => clearInterval(id);
  }, [state.paused, dispatch]);
  useEffect(() => {
    const onSchedule = (event: ScheduleEvent) => {
      if (event.type === 'agent')
        return apply({ type: 'agent', event: event.event, ms: Date.now() });
      // Dispatched, not applied: the message it becomes must reach the agent (`agentCalls`).
      if (event.type === 'autofix')
        return dispatch({
          type: 'autofix',
          threadId: event.threadId,
          event: event.event,
        });
      apply(
        event.type === 'ci'
          ? { type: 'ci-result', event }
          : { type: 'schedule-run', event },
      );
    };
    const off = host.schedule.onEvent(onSchedule);
    // What happened while no window was open: runs and their agent's events, in order.
    void host.schedule.drain().then(
      (events) => events.forEach(onSchedule),
      (error: unknown) => console.error('Reading scheduled runs failed', error),
    );
    return off;
  }, [apply, dispatch]);
  useEffect(() => {
    const onToolCall = (call: AgentToolCall) => {
      const env = toolEnv(replica.getState, dispatch);
      void (
        import.meta.env.DEV && call.threadId === '__dev__'
          ? runDevTool(call, env)
          : runTool(call, env)
      ).then((result) => host.agent.toolResult(call.id, result));
    };
    const off = host.agent.onToolCall(onToolCall);
    // Asked only once listening, so a call main sends meanwhile arrives once, by one route or the other.
    void host.agent.pendingToolCalls().then(
      (calls) => {
        dispatch({
          type: 'window-loaded',
          threadIds: [...new Set(calls.map((c) => c.threadId))],
        });
        calls.forEach(onToolCall);
      },
      (error: unknown) =>
        console.error('Taking back tool calls after reload failed', error),
    );
    return off;
  }, [replica, dispatch]);
  useEffect(() => {
    savePanes(state.panes);
  }, [state.panes]);
  useEffect(() => saveSideChats(state.sidechats), [state.sidechats]);
  return (
    <HarnessContext.Provider value={value}>
      <WindowReactor />
      {children}
    </HarnessContext.Provider>
  );
}

/** A torn-off window's store: the same stream as the main window's, the same dispatch, none of the main window's work. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { value } = useStoreValue();
  return (
    <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
  );
}

/**
 * Hands its children a store over state held elsewhere: another computer's threads as its streams last sent them, a replay's
 * step. Readers re-render for what they select, as in the window's own store.
 */
export function StoreScope({
  state,
  dispatch,
  children,
}: {
  state: State;
  dispatch: Dispatch<Action>;
  children: ReactNode;
}) {
  const [store] = useState(() => createStore<State>()(() => state));
  useLayoutEffect(() => store.setState(state, true), [store, state]);
  const value = { store, getState: store.getState, dispatch };
  return (
    <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
  );
}

/**
 * A `StoreScope` over this window's own state, `derive`d from it on every change by subscription: the scope never re-renders
 * for a streamed token, and readers re-render only for what they select. `dispatch` may change identity freely.
 */
export function DerivedScope({
  derive,
  dispatch,
  children,
}: {
  derive: (state: State) => State;
  dispatch: Dispatch<Action>;
  children: ReactNode;
}) {
  const base = useHarnessStore();
  const [store] = useState(() =>
    createStore<State>()(() => derive(base.getState())),
  );
  useLayoutEffect(() => {
    const apply = () => store.setState(derive(base.getState()), true);
    apply();
    return base.store.subscribe(apply);
  }, [base, store, derive]);
  const latest = useRef(dispatch);
  useLayoutEffect(() => {
    latest.current = dispatch;
  });
  const [value] = useState(() => ({
    store,
    getState: store.getState,
    dispatch: (action: Action) => latest.current(action),
  }));
  return (
    <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
  );
}

function useStoreValue() {
  const replica = requireReplica();
  const { dispatch, apply } = storeDispatch(replica);
  useProjectionContext(replica, dispatch);
  const value = { store: replica.store, getState: replica.getState, dispatch };
  return { replica, value, apply };
}

/**
 * Applies an action here and sends it to Core when it changes the projection (`Replica.dispatch`), with what it sets off:
 * the agent calls it means (`agentCalls`), an answer to the agent that asked, the schedule's trigger.
 */
function storeDispatch(replica: Replica) {
  const apply = (action: Action) => {
    recordAction(replica.getState(), action);
    replica.dispatch(action);
  };
  const dispatch: Dispatch<Action> = (dispatched) => {
    const before = replica.getState();
    const action = withDispatchContext(before, dispatched);
    recordAction(before, action);
    if (action.type === 'answer') markOwnAnswer(action.queueId);
    const answer = resolution(before, action);
    if (answer)
      host.agent
        .resolve(answer.requestId, answer.decision)
        .catch((error: unknown) =>
          apply({
            type: 'say',
            threadId: answer.threadId,
            entry: undelivered(answer, error),
          }),
        );
    let after: State | undefined;
    const next = () => (after ??= reducer(before, action));
    const calls = agentCalls(before, action, next);
    for (const input of scheduleCalls(before, action, next))
      host.schedule
        .set(input)
        .catch((error: unknown) =>
          console.error('Saving the schedule failed', error),
        );
    // A deleted thread takes its trigger with it.
    if (action.type === 'delete')
      for (const id of action.threadIds)
        host.schedule
          .remove(id)
          .catch((error: unknown) =>
            console.error('Removing the schedule failed', error),
          );
    replica.dispatch(action, next());
    for (const call of calls) {
      // A call that throws (bad options, no adapter) ends the turn as failed, so the thread says why instead of spinning.
      callAgent(replica, call).catch((error: unknown) => {
        const thread =
          call.method === 'send' && isLostProcess(error)
            ? replica.getState().threads.find((t) => t.id === call.threadId)
            : undefined;
        const retry =
          thread && call.method === 'send'
            ? resumeAfterLostProcess(thread, call)
            : [];
        if (retry.length === 0) return apply(failed(call.threadId, error));
        for (const again of retry) {
          if (again.method === 'start')
            replica.dispatch({
              type: 'agent-starting',
              threadId: again.threadId,
              provider: again.options.provider,
            });
          callAgent(replica, again).catch((e: unknown) =>
            apply(failed(again.threadId, e)),
          );
        }
      });
    }
    for (const threadId of unsentTurns(before, next(), calls))
      apply(failed(threadId, new Error('Mochi had no agent to send this to')));
    // After the action: a new thread only exists once it has applied.
    for (const call of calls)
      if (call.method === 'start')
        replica.dispatch({
          type: 'agent-starting',
          threadId: call.threadId,
          provider: call.options.provider,
        });
    if (action.type === 'workspace')
      void retarget(next().threads.find((t) => t.id === action.threadId));
    const acted = actedOn(action, before.queue);
    if (acted)
      host.notify
        .addressed({ threadId: acted, isActedOn: true })
        .catch(() => undefined);
  };
  return { dispatch, apply };
}

/** What a fold reads from this window, put on the action, so Core and other windows fold it the same way. */
function withDispatchContext(state: State, action: Action): Action {
  if (action.type === 'create' && !action.spaceId)
    return { ...action, spaceId: state.spaceId };
  if (action.type === 'agent' && action.ms === undefined)
    return { ...action, ms: Date.now() };
  return action;
}

/**
 * Keeps your prefs and pins (`ProjectionContext`) one value between this window and Core, which holds them in its settings
 * store: Core's when it changes (another window, a device), yours when you change them here. A window that finds Core with
 * none sends its own once, migrating them out of this window's storage; likewise profiles and any pref Core doesn't hold yet.
 * Profiles change only in Core (`src/profiles.ts`), so this carries Core's along.
 */
function useProjectionContext(replica: Replica, dispatch: Dispatch<Action>) {
  const prefs = usePrefs();
  const pins = useAllPins();
  const held = useStore(replica.store, (s) => s.context);
  const local: ProjectionContext = {
    prefs: projectionPrefs(prefs),
    pins,
    ...(held.profiles && { profiles: held.profiles }),
  };
  /** The value both sides last agreed on, as JSON. */
  const synced = useRef<string | null>(null);
  useEffect(() => {
    const core = JSON.stringify(held);
    const mine = JSON.stringify(local);
    const isFirst = synced.current === null;
    const coreHeld = replica.isContextSet() ? held : null;
    const migrated =
      isFirst && migratedContext(coreHeld, local, storedProfiles);
    if (migrated) {
      if (coreHeld && mine !== JSON.stringify(migrated)) adoptContext(migrated);
      synced.current = JSON.stringify(migrated);
      return dispatch({ type: 'context', context: migrated });
    }
    if (isFirst || core !== synced.current) {
      synced.current = core;
      // Written here so this window's own readers (Settings, the pin rail) show Core's values.
      if (mine !== core) adoptContext(held);
      return;
    }
    if (mine === synced.current) return;
    synced.current = mine;
    dispatch({ type: 'context', context: local });
  }, [held, local, replica, dispatch]);
}

function adoptContext({ prefs, pins }: ProjectionContext) {
  setPrefs(projectionPrefs(prefs));
  replaceAllPins(pins);
}

// Sequential: a handoff's stop must reach the old agent before the new one starts in the same thread.
let pending: Promise<unknown> = Promise.resolve();

function callAgent(replica: Replica, call: AgentCall) {
  const run = () =>
    (
      host.agent[call.method] as (
        threadId: string,
        ...args: unknown[]
      ) => Promise<unknown>
    )(call.threadId, ...agentCallArgs(call));
  // After the commands sent so far are logged: the agent's reply folds after the message it answers.
  const next = pending.then(() => replica.sent()).then(run);
  pending = next.catch(() => {});
  return next;
}

function isLostProcess(error: unknown) {
  return error instanceof Error && error.message.includes(NO_AGENT_PROCESS);
}

function failed(threadId: string, error: unknown): Action {
  return {
    type: 'agent',
    event: {
      threadId,
      type: 'turn-end',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    },
    ms: Date.now(),
  };
}

function useHarnessStore() {
  const store = useContext(HarnessContext);
  if (!store) throw new Error('useHarness must be used inside HarnessProvider');
  return store;
}

/** The whole state: re-renders on every change, agent tokens included. Prefer `useHarnessSelector` for what a component shows. */
export function useHarness() {
  const store = useHarnessStore();
  return { state: useStore(store.store), dispatch: store.dispatch };
}

export function useDispatch() {
  return useHarnessStore().dispatch;
}

/** The newest state, read when called (an event handler, a drag), without re-rendering on changes. */
export function useGetState() {
  return useHarnessStore().getState;
}

/** What `select` picks from the state; re-renders only when that changes by `isEqual` (`shallowEqual` for a picked object or list). */
export function useHarnessSelector<T>(
  select: (state: State) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
) {
  return useStoreWithEqualityFn(useHarnessStore().store, select, isEqual);
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
  return useHarnessSelector(
    (s) =>
      s.threads.filter(
        (t) => t.spaceId === (spaceId ?? s.spaceId) && isListed(t),
      ),
    shallowEqual,
  );
}

/** The space's threads to list them (`isSameListing`): stale in what a turn streams, so each row reads its own thread for that. */
export function useSpaceListing(spaceId: string) {
  return useHarnessSelector(
    (s) => s.threads.filter((t) => t.spaceId === spaceId && isListed(t)),
    isSameListing,
  );
}

export function useSpaceQueue(spaceId?: string) {
  return useHarnessSelector((s) => {
    const id = spaceId ?? s.spaceId;
    const ids = new Set(
      s.threads.filter((t) => t.spaceId === id && isListed(t)).map((t) => t.id),
    );
    return rankQueue(s.queue.filter((q) => ids.has(q.threadId)));
  }, shallowEqual);
}

export function snapshot(state: State): Snapshot {
  return { threads: state.threads, queue: state.queue };
}

/** A scheduled thread's trigger keeps how main starts it; a new workspace before its first run replaces that. */
async function retarget(thread: Thread | undefined) {
  if (!thread) return;
  const trigger = (await host.schedule.list()).find(
    (t) => t.threadId === thread.id,
  );
  const input =
    trigger &&
    triggerInput(thread, {
      when: trigger.when,
      missed: trigger.missed,
      name: trigger.name,
      prompt: trigger.prompt,
    });
  if (input)
    await host.schedule
      .set(input)
      .catch((error: unknown) =>
        console.error('Saving the schedule failed', error),
      );
}
