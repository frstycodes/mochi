import type { SeqAgentEvent } from '../../../src/host/types/agent.ts';
import { scheduleReducer } from '../../../src/schedule/slice.ts';
import { reviewsReducer } from '../../../src/secondOpinion/slice.ts';
import { withContext } from '../../../src/store/context.ts';
import { initialQueue, queueReducer } from '../../../src/store/queue.ts';
import type { Saved } from '../../../src/store/saved.ts';
import { initialThreads, threadsReducer } from '../../../src/store/threads.ts';
import type { Action, State } from '../../../src/store/types.ts';
import { applyUndo } from '../../../src/runtime/undo.ts';
import type { LoggedEvent } from './shell.ts';

/** The store's slices Core owns: the threads and what is saved with them. Layout, panes and the rest stay per window. */
export const DOMAIN_KEYS = [
  'now',
  'threads',
  'seq',
  'checkpoints',
  'checkpointSeq',
  'rewindUndo',
  'forks',
  'queue',
  'context',
] as const;
export type Domain = Pick<State, (typeof DOMAIN_KEYS)[number]>;

/** In this order: the schedule and review slices read what the thread slice just did. */
const DOMAIN_SLICES = [
  threadsReducer,
  queueReducer,
  reviewsReducer,
  scheduleReducer,
];

/**
 * The thread projection, `(state, action) => state`: every window and Core fold the same log with it. `ms` is when the event
 * was logged, the wall clock what it stamps reads. The slices are the renderer's (`src/store/root.ts` runs them with the
 * per-window ones); none of them reads a per-window field.
 */
export function project<D extends Domain>(
  domain: D,
  action: Action,
  ms?: number,
): D {
  const state = domain as unknown as State;
  if (action.type === 'tool-undo')
    return applyUndo(state, action.undo).state as unknown as D;
  return withContext(
    domain.context,
    () => DOMAIN_SLICES.reduce((s, slice) => slice(s, action), state),
    ms,
  ) as unknown as D;
}

export const domainOf = (state: Domain): Domain =>
  Object.fromEntries(DOMAIN_KEYS.map((key) => [key, state[key]])) as Domain;

export const isDomainChange = (before: Domain, after: Domain) =>
  DOMAIN_KEYS.some((key) => before[key] !== after[key]);

/** Event types in Core's log the projection folds: an agent's events and the commands windows send. */
export const COMMAND_TYPE = 'command';
export const AGENT_PREFIX = 'agent.';

/** The action a logged event folds as; undefined for one the projection doesn't fold (a save, a project list). */
export function actionOf(event: LoggedEvent): Action | undefined {
  if (event.type === COMMAND_TYPE) return event.payload as Action;
  if (event.type.startsWith(AGENT_PREFIX))
    return {
      type: 'agent',
      event: event.payload as SeqAgentEvent,
      ms: event.at,
    };
  return undefined;
}

/** Core's projection from a save: its threads as they were, none of the demo's. */
export const domainFrom = (saved: Saved | null): Domain =>
  domainOf({ ...initialThreads(saved, false), ...initialQueue(saved, false) });

/**
 * One item of the `replica` stream a window's store follows: the whole projection (`saved` is a `Saved`, decoded by the
 * window with `Persist.Saved`), or one event it folds.
 */
export type ReplicaItem =
  | {
      readonly _tag: 'snapshot';
      readonly sequence: number;
      readonly saved: unknown;
      readonly context: unknown;
    }
  | { readonly _tag: 'event'; readonly event: LoggedEvent };
