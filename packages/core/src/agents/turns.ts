import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from 'effect';

/** What a turn can ask of the person while it runs; resolved by `answer`, released when the turn stops. */
export interface TurnContext {
  readonly threadId: string;
  /** Waits for `answer(threadId, requestId, …)`. Stopping the turn withdraws the request. */
  readonly ask: (requestId: string) => Effect.Effect<unknown>;
}

export type Turn<E> = (context: TurnContext) => Effect.Effect<void, E, Scope.Scope>;

/**
 * Every running turn is a fiber in its own scope. Stopping a turn interrupts that fiber, so whatever it acquired with
 * `acquireRelease` (child processes, pending approvals, timers) is released in reverse order before `stop` returns.
 */
export class Turns extends Context.Service<Turns>()('mochi/core/Turns', {
  make: Effect.gen(function* () {
    const running = new Map<string, Fiber.Fiber<void, unknown>>();
    const pending = new Map<string, Deferred.Deferred<unknown>>();
    const keyOf = (threadId: string, requestId: string) => `${threadId}\u0000${requestId}`;

    const contextFor = (threadId: string): TurnContext => ({
      threadId,
      ask: (requestId) =>
        Effect.scoped(
          Effect.gen(function* () {
            const key = keyOf(threadId, requestId);
            const deferred = yield* Effect.acquireRelease(Deferred.make<unknown>(), () => Effect.sync(() => pending.delete(key)));
            pending.set(key, deferred);
            return yield* Deferred.await(deferred);
          }),
        ),
    });

    /** Fails when the thread already has a turn running; the turn's own failure ends it and is logged. */
    const start = <E>(threadId: string, turn: Turn<E>) =>
      Effect.gen(function* () {
        if (running.has(threadId)) return yield* Effect.fail(`${threadId} already has a turn running`);
        const scope = yield* Scope.make();
        const fiber = yield* turn(contextFor(threadId)).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Turn failed', cause).pipe(Effect.annotateLogs({ source: 'agents', threadId }))),
          Effect.onExit((exit) => Effect.andThen(Scope.close(scope, Exit.isFailure(exit) ? exit : Exit.void), Effect.sync(() => running.delete(threadId)))),
          Effect.provideService(Scope.Scope, scope),
          Effect.forkDetach,
        );
        running.set(threadId, fiber);
      });

    /** Interrupts the thread's turn and waits until everything it held is released. A thread with none is a no-op. */
    const stop = (threadId: string) => Effect.suspend(() => (running.has(threadId) ? Fiber.interrupt(running.get(threadId)!) : Effect.void));

    /** False when nothing waits on that request (already answered, or its turn stopped). */
    const answer = (threadId: string, requestId: string, value: unknown) =>
      Effect.suspend(() => {
        const deferred = pending.get(keyOf(threadId, requestId));
        return deferred ? Deferred.succeed(deferred, value) : Effect.succeed(false);
      });

    const isRunning = (threadId: string) => running.has(threadId);
    const isWaiting = (threadId: string, requestId: string) => pending.has(keyOf(threadId, requestId));

    return { start, stop, answer, isRunning, isWaiting };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
