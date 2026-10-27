import { Schema } from 'effect';
import { Model } from '@mochi/schema';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  actionOf,
  COMMAND_TYPE,
  DOMAIN_KEYS,
  domainOf,
  project,
  type Domain,
  type LoggedEvent,
  type ReplicaItem,
} from '@mochi/domain';
import type { ProjectionContext } from './context.ts';
import { reducer } from './root.ts';
import { savedFrom, toSaved, type Saved } from './saved.ts';
import type { Action, State } from './types.ts';

/** Where a window's store reads the projection from and sends its commands: Core (`coreLog`), or the page itself (web). */
export interface ReplicaLog {
  /** Items after `afterSequence` (a snapshot when the log can't replay them), then live ones, until `onEnd`. Returns a stop. */
  follow(
    afterSequence: number,
    onItem: (item: ReplicaItem) => void,
    onEnd: (error?: unknown) => void,
  ): () => void;
  /** Resolves once logged; a resend with the same id is logged once. */
  append(command: {
    commandId: string;
    threadId: string | null;
    action: Action;
  }): Promise<unknown>;
}

export interface Replica {
  store: StoreApi<State>;
  /** The newest state, own commands included before Core logged them. */
  getState: () => State;
  /** `next` is `reducer(getState(), action)`, which the caller already worked out for the action's side effects. */
  dispatch: (action: Action, next?: State) => void;
  /** Settles once every command sent so far is logged, so an agent call never overtakes the command it follows. */
  sent: () => Promise<unknown>;
  /** The last logged event folded in. */
  sequence: () => number;
  /** Whether Core holds your prefs and pins (`context`) yet; until then this window migrates its own. */
  isContextSet: () => boolean;
  /** Each agent event and other window's command as it folds, with the state before it. Returns a stop. */
  listen: (listener: (action: Action, before: State) => void) => () => void;
  stop: () => void;
}

/** A dropped stream is followed again from where it stopped, this often. */
const RESUME_MS = 1000;

/**
 * A window's store: a read-only replica of Core's thread projection, fed by `replica` items, plus this window's own slices
 * (layout, panes). A command (an action that changes the projection) applies here at once, goes to Core, and folds again in
 * Core's order when it comes back: until then, events from Core fold beneath the window's pending commands, which replay on
 * top (`rebase`). Streamed items reach subscribers once a batch (`BATCH_MS`); your own actions at once. Resolves on the first item.
 */
export function createReplica(
  log: ReplicaLog,
  initial: (saved: Saved | null) => State,
  schedule = nextBatch,
): Promise<Replica> {
  const origin = crypto.randomUUID();
  let count = 0;
  let state: State | undefined;
  let store: StoreApi<State> | undefined;
  let sequence = 0;
  /** Own commands not logged back yet, oldest first, and the projection as the log has it beneath them. */
  let pending: { id: string; action: Action }[] = [];
  let confirmed: Domain | null = null;
  let sending: Promise<unknown> = Promise.resolve();
  let cancelFrame: (() => void) | null = null;
  let stopFollow = () => {};
  let isStopped = false;
  let isContextSet = false;
  const listeners = new Set<(action: Action, before: State) => void>();

  const flush = () => {
    cancelFrame?.();
    cancelFrame = null;
    if (store && state !== store.getState()) store.setState(state!, true);
  };
  const defer = () => (cancelFrame ??= schedule(flush));

  const rebase = (base: Domain) =>
    pending.reduce((d, p) => project(d, p.action), base);

  const onEvent = (event: LoggedEvent) => {
    const action = actionOf(event);
    if (!action) return;
    if (action.type === 'context') isContextSet = true;
    const fold = { ms: event.at, isForeign: event.type === COMMAND_TYPE };
    if (pending[0] && event.commandId === pending[0].id) {
      // Ours: its window slices applied when it was sent.
      pending.shift();
      confirmed = project(confirmed!, action, event.at);
      state = { ...state!, ...rebase(confirmed) };
      if (!pending.length) confirmed = null;
      return;
    }
    for (const listener of listeners) listener(action, state!);
    if (!pending.length) {
      state = reducer(state!, action, fold);
      return;
    }
    confirmed = project(confirmed!, action, event.at);
    state = { ...reducer(state!, action, fold), ...rebase(confirmed) };
  };

  const onItem = (item: ReplicaItem, ready: () => void) => {
    if (item._tag === 'snapshot') {
      // Pending commands are in it or still on their way: either way they fold from the log.
      pending = [];
      confirmed = null;
      const saved = item.saved === null ? null : savedFrom(item.saved);
      if (item.saved !== null && !saved)
        console.error(
          'Core sent a snapshot this version can’t read; keeping what this window holds',
        );
      state = state ? merged(state, saved) : initial(saved);
      const context = decodeContext(item.context);
      isContextSet = !!context;
      if (context) state = { ...state, context };
      sequence = item.sequence;
      store ??= createStore<State>()(() => state!);
      flush();
      return ready();
    }
    // The first follow starts from 0, which Core always answers with a snapshot.
    if (!state || item.event.sequence <= sequence) return;
    sequence = item.event.sequence;
    onEvent(item.event);
    defer();
  };

  return new Promise<Replica>((resolve) => {
    const replica: Replica = {
      get store() {
        return store!;
      },
      getState: () => state!,
      dispatch: (action, next = reducer(state!, action)) => {
        const before = state!;
        state = next;
        if (
          DOMAIN_KEYS.some((k) => before[k] !== next[k]) &&
          action.type !== 'reset'
        ) {
          if (!pending.length) confirmed = domainOf(before);
          const id = `${origin}:${++count}`;
          pending.push({ id, action });
          const threadId =
            'threadId' in action && typeof action.threadId === 'string'
              ? action.threadId
              : null;
          sending = sending.then(() =>
            log
              .append({ commandId: id, threadId, action })
              .catch((error: unknown) => {
                console.error(
                  'Sending a command to Core failed; it is dropped',
                  error,
                );
                pending = pending.filter((p) => p.id !== id);
                if (confirmed) state = { ...state!, ...rebase(confirmed) };
                if (!pending.length) confirmed = null;
                flush();
              }),
          );
        }
        flush();
      },
      sent: () => sending,
      sequence: () => sequence,
      isContextSet: () => isContextSet,
      listen: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      stop: () => {
        isStopped = true;
        stopFollow();
        cancelFrame?.();
      },
    };
    const follow = () => {
      stopFollow = log.follow(
        sequence,
        (item) => onItem(item, () => resolve(replica)),
        (error) => {
          if (isStopped) return;
          if (error)
            console.error(
              'The store’s stream from Core ended; following it again',
              error,
            );
          setTimeout(follow, RESUME_MS);
        },
      );
    };
    follow();
  });
}

/** A snapshot after a long gap: Core's threads replace this window's, the ones only it holds (the demo's) stay. */
function merged(state: State, saved: Saved | null): State {
  if (!saved) return state;
  const mine = toSaved(state);
  const ids = new Set(mine.threads.map((t) => t.id));
  const local = state.threads.filter((t) => !ids.has(t.id));
  const localIds = new Set(local.map((t) => t.id));
  const pick = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).filter(([id]) => localIds.has(id)),
    );
  return {
    ...state,
    now: Math.max(state.now, saved.now),
    seq: saved.seq,
    threads: [...local, ...saved.threads],
    queue: [
      ...state.queue.filter((q) => localIds.has(q.threadId)),
      ...saved.queue,
    ],
    checkpoints: { ...pick(state.checkpoints), ...saved.checkpoints },
    checkpointSeq: saved.checkpointSeq,
    forks: { ...pick(state.forks), ...saved.forks },
  };
}

const Pin = Schema.Struct({
  id: Schema.String,
  index: Schema.Number,
  text: Schema.String,
});
const ContextSchema = Schema.Struct({
  prefs: Schema.Struct({
    goals: Schema.Boolean,
    driftGuard: Schema.Boolean,
    autofixPrs: Schema.Boolean,
    autoArchivePrs: Schema.Boolean,
    workspaceMode: Schema.Literals(['worktree', 'folder']),
    branchPrefix: Schema.String,
    idleChecks: Schema.Literals(['edited', 'always', 'off']),
    simplifyAuto: Schema.Boolean,
    simplifyAutoWords: Schema.Number,
    // Joined the context after the rest: a context Core saved before then has none.
    simplifyLength: Schema.optional(Schema.Literals(['short', 'detailed'])),
    simplifyNeedsFirst: Schema.optional(Schema.Boolean),
    simplifyRules: Schema.optional(Schema.String),
    turnSpine: Schema.optional(Schema.Boolean),
    whileWorking: Schema.Literals(['queue', 'steer']),
  }),
  pins: Schema.Record(Schema.String, Schema.Array(Pin)),
  profiles: Schema.optional(Schema.Array(Model.Space)),
});
const decodeContextOption = Schema.decodeUnknownOption(ContextSchema);
// The prefs Core doesn't hold yet stay unset: the first window to sync migrates its own (`migratedContext`).
const decodeContext = (value: unknown) => {
  const decoded = decodeContextOption(value);
  return decoded._tag === 'Some' ? (decoded.value as ProjectionContext) : null;
};

// A few streamed tokens per commit instead of one a frame; the stream still reads as fluid. A timer, unlike an animation frame, also runs in a hidden window.
const BATCH_MS = 50;

function nextBatch(run: () => void) {
  const timer = setTimeout(run, BATCH_MS);
  return () => clearTimeout(timer);
}
