import { Effect, Queue, Scope } from 'effect';
import type { OutboxEffect, Store } from '../store/store.ts';

// Pattern from T3 Code's `EffectWorker.ts` (pingdotgg/t3code @ 5ffe045): claim due rows, run each, record the outcome, sleep
// until woken. Nothing copied.

/** A failure that says nothing about the command, only that its executor can't run now (no window serves `reactor`): retried without limit. */
export class Unavailable extends Error {
  override readonly name = 'Unavailable';
}

const BATCH = 16;
const MAX_ATTEMPTS = 5;
const MAX_DELAY_MS = 60_000;
/** A wake nobody signalled: covers an effect whose retry timer died with a Core restart. */
const IDLE_MS = 30_000;

export const retryDelay = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), MAX_DELAY_MS);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `skipped`: the executor found the command no longer due. It is dropped, so its rule can emit it again once it is. */
export type Outcome = 'skipped' | void;

/**
 * Runs the outbox in the caller's scope: each claimed effect in its own fiber, so a slow one (a model call) holds back no
 * other. Success completes it; a skip releases it (`forget` hears its key); a failure is retried with backoff,
 * `MAX_ATTEMPTS` times unless it is `Unavailable`. Effects a Core restart left running are claimed again (the store resets
 * them at startup), so an executor must tolerate a rerun.
 */
export const outboxWorker = (store: Store['Service'], execute: (effect: OutboxEffect) => Effect.Effect<Outcome, unknown>, forget: (commandId: string) => void = () => {}) =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const signal = yield* Queue.sliding<void>(1);
    const wake = Effect.sync(() => void Queue.offerUnsafe(signal, undefined));
    const wakeAt = (at: number) => Effect.asVoid(Effect.forkIn(Effect.andThen(Effect.sleep(Math.max(0, at - Date.now())), wake), scope));

    const settle = (effect: OutboxEffect) =>
      execute(effect).pipe(
        Effect.matchEffect({
          onSuccess: (outcome) => (outcome === 'skipped' ? Effect.andThen(store.release(effect.id), Effect.sync(() => forget(effect.commandId))) : store.complete(effect.id)),
          onFailure: (error) => {
            const isRetried = error instanceof Unavailable || effect.attempt < MAX_ATTEMPTS;
            if (!isRetried) return Effect.andThen(Effect.logWarning(`Reactor ${effect.type} gave up: ${messageOf(error)}`), store.fail(effect.id, messageOf(error)));
            const at = Date.now() + retryDelay(effect.attempt);
            return Effect.andThen(store.fail(effect.id, messageOf(error), new Date(at).toISOString()), wakeAt(at));
          },
        }),
        Effect.annotateLogs({ source: 'reactor' }),
        // A store write that failed leaves the row running; the next start claims it again.
        Effect.catchCause((cause) => Effect.logError('Reactor outbox write failed', cause)),
      );

    const drain = Effect.gen(function* () {
      for (;;) {
        const batch = yield* store.claim(BATCH);
        for (const effect of batch) yield* Effect.forkIn(settle(effect), scope);
        if (batch.length < BATCH) return;
      }
    });

    yield* Effect.forkIn(
      drain.pipe(
        Effect.catchCause((cause) => Effect.logError('Reactor outbox claim failed', cause)),
        Effect.andThen(Effect.raceFirst(Queue.take(signal), Effect.sleep(IDLE_MS))),
        Effect.forever,
      ),
      scope,
    );
    return { wake, wakeAt };
  });
