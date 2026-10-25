import { Context, Effect, Layer, PubSub, Schedule, Stream } from 'effect';
import {
  actionOf,
  COMMAND_TYPE,
  domainFrom,
  isDomainChange,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_EVENTS,
  project,
  type Domain,
  type LoggedEvent,
  type ReplicaItem,
} from '@mochi/domain';
import type { ProjectionContext } from '../../../../src/store/context.ts';
import type { Action } from '../../../../src/store/types.ts';
import {
  joinSaved,
  restoreSavedThreads,
  splitSaved,
  toSaved,
} from '../../../../src/store/saved.ts';
import { sweepUnreferenced } from './handlers.ts';
import { Store } from './store.ts';

/** A snapshot write waits this long for more events, so a streamed reply writes about twice a second. */
const SAVE_EVERY = '500 millis';

/** Where Core keeps your prefs and pins the folds and reactor rules read (`ProjectionContext`): one settings document. */
export const SHARED_CONTEXT = { table: 'settings', key: 'shared' } as const;

/** Core's clock for the store: `tick` moves `now`, the minute clock activity is stamped with. */
const TICK_EVERY = '1 minute';

/** One fold: the event, and the state before and after it (what a reactor rule reads). */
export interface Folded {
  readonly event: LoggedEvent;
  readonly action: Action;
  readonly before: Domain;
  readonly after: Domain;
}

/**
 * The thread projection in Core, the one writer of thread snapshots. It loads the last snapshot, folds the log after it, marks
 * every agent stopped (none outlives Core), then folds each event as it is logged and writes changed threads every
 * `SAVE_EVERY`. Windows follow it through `replica`.
 */
export class Projection extends Context.Service<Projection>()(
  'mochi/core/Projection',
  {
    make: (userData: string | undefined) =>
      Effect.gen(function* () {
        const store = yield* Store;
        const folded = yield* PubSub.unbounded<Folded>();
        const logged = yield* store.subscribe;

        const files = yield* store.loadThreads;
        const saved = files && joinSaved(files);
        // An unreadable save is never overwritten: this run keeps its threads in memory only.
        const isSaveBlocked = !!files && !saved;
        if (isSaveBlocked)
          yield* Effect.logError(
            'The saved threads are not a save this version can read; saving is off until the next launch',
          ).pipe(Effect.annotateLogs({ source: 'store' }));
        if (files && userData)
          yield* Effect.forkDetach(sweepUnreferenced(userData, files));

        let sequence = files?.sequence ?? 0;
        // Null until a window sent its prefs and pins: the first to connect migrates its own (src/store/index.tsx).
        const shared = (yield* store.getDoc(
          SHARED_CONTEXT.table,
          SHARED_CONTEXT.key,
        )) as ProjectionContext | undefined;
        let isContextSet = !!shared;
        let domain: Domain = {
          ...domainFrom(saved),
          ...(shared && { context: shared }),
        };
        for (const event of yield* store.eventsAfter(sequence)) {
          const action = actionOf(event);
          if (action) domain = project(domain, action, event.at);
          sequence = event.sequence;
        }
        domain = { ...domain, ...restoredDomain(domain) };
        // A window that followed an earlier run resumes from a snapshot: this run's restore isn't in the log, this marker is.
        const { sequence: startSequence } = yield* store.append({
          type: 'core.started',
        });
        let isDirty = true;

        const fold = (event: LoggedEvent) =>
          Effect.suspend(() => {
            if (event.sequence <= sequence) return Effect.void;
            sequence = event.sequence;
            const action = actionOf(event);
            if (!action) return Effect.void;
            const before = domain;
            domain = project(domain, action, event.at);
            isDirty ||= isDomainChange(before, domain);
            const kept =
              action.type === 'context'
                ? store
                    .setDoc(
                      SHARED_CONTEXT.table,
                      SHARED_CONTEXT.key,
                      domain.context,
                    )
                    .pipe(
                      Effect.tap(() =>
                        Effect.sync(() => (isContextSet = true)),
                      ),
                      Effect.ignore,
                    )
                : Effect.void;
            return Effect.andThen(
              kept,
              PubSub.publish(folded, { event, action, before, after: domain }),
            );
          });
        yield* Stream.fromSubscription(logged).pipe(
          Stream.runForEach(fold),
          Effect.forkScoped,
        );

        const written = new Map<string, string>();
        let lastIndex = '';
        const save = Effect.suspend(() => {
          if (!isDirty || isSaveBlocked) return Effect.void;
          isDirty = false;
          const at = sequence;
          const { index, threads } = splitSaved(toSaved(domain));
          const changed = Object.fromEntries(
            Object.entries(threads).filter(
              ([id, json]) => written.get(id) !== json,
            ),
          );
          if (index === lastIndex && !Object.keys(changed).length)
            return Effect.void;
          return store.saveThreads(index, changed, at).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                lastIndex = index;
                for (const [id, json] of Object.entries(changed))
                  written.set(id, json);
                for (const id of written.keys())
                  if (!(id in threads)) written.delete(id);
              }),
            ),
            // The next round writes them again.
            Effect.catch((error) =>
              Effect.sync(() => (isDirty = true)).pipe(
                Effect.andThen(
                  Effect.logError(`Saving threads failed: ${error.message}`),
                ),
                Effect.annotateLogs({ source: 'store' }),
              ),
            ),
          );
        });
        yield* save.pipe(
          Effect.repeat(Schedule.spaced(SAVE_EVERY)),
          Effect.forkScoped,
        );
        yield* Effect.addFinalizer(() => save);
        yield* store
          .append({
            type: COMMAND_TYPE,
            payload: { type: 'tick' } satisfies Action,
          })
          .pipe(
            Effect.ignore,
            Effect.repeat(Schedule.spaced(TICK_EVERY)),
            Effect.delay(TICK_EVERY),
            Effect.forkScoped,
          );

        /**
         * The whole projection: the events after `afterSequence` when few and small enough, else a snapshot; then each event as
         * it folds. Subscribed before reading, so nothing folds unseen in between.
         */
        const replica = (
          afterSequence: number,
        ): Stream.Stream<ReplicaItem, unknown> =>
          Stream.unwrap(
            Effect.gen(function* () {
              const live = yield* PubSub.subscribe(folded);
              const at = sequence;
              // As JSON: the store leaves optional fields undefined, which the socket's encoder refuses.
              const snapshot: ReplicaItem = JSON.parse(
                JSON.stringify({
                  _tag: 'snapshot',
                  sequence: at,
                  saved: toSaved(domain),
                  context: isContextSet ? domain.context : null,
                }),
              );
              const gap =
                afterSequence > 0 &&
                afterSequence >= startSequence &&
                afterSequence <= at
                  ? yield* replay(afterSequence, at)
                  : undefined;
              const items = gap ?? [snapshot];
              const tail = Stream.fromSubscription(live).pipe(
                Stream.filter(({ event }) => event.sequence > at),
                Stream.map(({ event }): ReplicaItem => ({
                  _tag: 'event',
                  event,
                })),
              );
              return Stream.concat(Stream.fromIterable(items), tail);
            }),
          );

        /** The folded events in (after, upTo], or undefined past the replay bounds. */
        const replay = (after: number, upTo: number) =>
          Effect.map(
            store.eventsAfter(after, MAX_REPLAY_EVENTS + 1),
            (events): ReplicaItem[] | undefined => {
              const gap = events.filter((e) => e.sequence <= upTo);
              const bytes = gap.reduce(
                (sum, e) => sum + JSON.stringify(e.payload).length,
                0,
              );
              if (gap.length > MAX_REPLAY_EVENTS || bytes > MAX_REPLAY_BYTES)
                return undefined;
              return gap
                .filter((e) => actionOf(e))
                .map((event) => ({ _tag: 'event', event }));
            },
          );

        return {
          current: Effect.sync(() => ({ sequence, domain })),
          folded: Stream.fromPubSub(folded),
          replica,
        };
      }),
  },
) {
  static readonly layer = (userData: string | undefined) =>
    Layer.effect(this, this.make(userData));
}

/** No agent outlives Core: every thread comes back idle and detached, its approvals gone (`restoreSavedThreads`). */
function restoredDomain(domain: Domain) {
  const { threads, queue } = restoreSavedThreads(toSaved(domain));
  const restored = new Map(threads.map((t) => [t.id, t]));
  return {
    threads: domain.threads.map((t) => restored.get(t.id) ?? t),
    queue: domain.queue.filter(
      (q) => queue.includes(q) || !threads.some((t) => t.id === q.threadId),
    ),
  };
}
