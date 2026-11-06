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
import { host } from '../host/index.ts';
import { showsDemoData } from '../demoData.ts';
import type { AgentToolCall } from '../host/types/agent.ts';
import { isListed } from '../model.ts';
import { isSameListing } from '../reorder.ts';
import { followProfiles, storedProfiles, useProfiles } from '../profiles.ts';
import { setWorktreePath } from '../git/worktrees.ts';
import { hearToolDecision, runTool } from '../runtime/tools.ts';
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
import { pageLog, transportLog } from './replicaLog.ts';
import { backends, LOCAL_BACKEND } from '../backends/registry.ts';
import { loopbackTransport, pageTransport } from '../backends/transport.ts';
import { saveSideChats } from './sidechat.ts';
import { shallow as shallowEqual } from 'zustand/vanilla/shallow';
import { initialState } from './root.ts';
import { pageCommand } from './pageCommand.ts';
import type { Action, Snapshot, State } from './types.ts';
import { recordAction } from '../replay/recorder.ts';
import { markOwnAnswer } from '@mochi/domain/remote/answers';
import { WindowReactor } from '../reactor/WindowReactor.tsx';

export type { View } from './layout.ts';
export { rankQueue };
export { mirrorState, reducer } from './root.ts';
export { shallow as shallowEqual } from 'zustand/vanilla/shallow';

export type { Action, Snapshot, State } from './types.ts';

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
  if (replica) return;
  const transport = host.hasCore ? loopbackTransport() : pageTransport();
  replica = await createReplica(
    host.hasCore ? transportLog(transport) : pageLog(),
    (saved) => initialState(saved),
  );
  // The window's store is this computer's entry in the registry, the way another computer's replica is its own.
  backends.add({ id: LOCAL_BACKEND, isLocal: true, transport, replica });
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
  const { replica, value } = useStoreValue();
  const { dispatch } = value;
  const state = useStore(replica.store);
  // Agent events and other windows' commands, as they fold; this window's own are recorded as they are dispatched.
  useEffect(
    () =>
      replica.listen((action, before) => {
        recordAction(before, action);
        hearToolDecision(action, before);
      }),
    [replica],
  );
  // The demo's clock runs 60× fast; real threads keep Core's, one tick a minute.
  useEffect(() => {
    if (state.paused || !showsDemoData()) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), DEMO_TICK_MS);
    return () => clearInterval(id);
  }, [state.paused, dispatch]);
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
  const dispatch = storeDispatch(replica);
  useProjectionContext(replica, dispatch);
  const value = { store: replica.store, getState: replica.getState, dispatch };
  return { replica, value };
}

/**
 * Applies an action here and sends it to Core when it is a command (`isCommand` in `Replica.dispatch`). Core acts on it: the agent
 * calls it means, the answer to the agent that asked, the schedule's trigger (`Commands` in packages/core/src/store/commands.ts).
 * The web build has no Core, so the page acts on its own commands (`pageCommand`).
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
    hearToolDecision(action, before);
    if (action.type === 'answer') markOwnAnswer(action.queueId);
    if (host.hasCore) return replica.dispatch(action);
    pageCommand(replica, before, action, apply);
  };
  return dispatch;
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
