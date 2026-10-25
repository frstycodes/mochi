import { Cause, Effect, Exit, Fiber, Schedule, Stream } from 'effect';

// A stream ends when Core restarts or a read fails (signed out, offline); its next subscription starts with a fresh read.
const RESUBSCRIBE = '1 minute';

/**
 * One stream per wanted payload, kept across `set` calls while the payload stays wanted, and re-subscribed after it ends.
 * For main's watchers (CI, Auto-fix, PR triggers), whose wanted set changes with the renderer's config.
 */
export function keyedStreams<P, A>(
  open: (payload: P) => Stream.Stream<A, unknown>,
  onValue: (payload: P, value: A) => void,
  onError: (payload: P, error: unknown) => void,
) {
  const live = new Map<string, Fiber.Fiber<unknown>>();
  return (wanted: ReadonlyArray<P>) => {
    const next = new Map(
      wanted.map((payload) => [JSON.stringify(payload), payload]),
    );
    for (const [key, fiber] of live) {
      if (next.has(key)) continue;
      live.delete(key);
      Effect.runFork(Fiber.interrupt(fiber));
    }
    for (const [key, payload] of next) {
      if (live.has(key)) continue;
      const watch = Stream.runForEach(open(payload), (value) =>
        Effect.sync(() => onValue(payload, value)),
      ).pipe(
        Effect.exit,
        Effect.tap((exit) =>
          Effect.sync(
            () =>
              Exit.isFailure(exit) &&
              onError(payload, Cause.squash(exit.cause)),
          ),
        ),
        Effect.repeat(Schedule.spaced(RESUBSCRIBE)),
      );
      live.set(key, Effect.runFork(watch));
    }
  };
}
