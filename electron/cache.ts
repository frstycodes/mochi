import { Cause, Effect, Exit, ManagedRuntime, type Duration } from 'effect';
import { Cache } from '@mochi/core/cache';

const runtime = ManagedRuntime.make(Cache.layer);

/** `load()`'s result, kept for `ttl` under `key`; concurrent callers share one load. A rejection is rethrown as is and not kept. */
export async function cached<A>(
  key: string,
  ttl: Duration.Input,
  load: () => Promise<A>,
): Promise<A> {
  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const cache = yield* Cache;
      return yield* cache.get(
        key,
        // @effect-diagnostics-next-line unknownInEffectCatch:off - the rejection is rethrown to the caller as is.
        Effect.tryPromise({ try: load, catch: (error) => error }),
        ttl,
      );
    }),
  );
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}

export const uncache = (key: string) =>
  runtime.runPromise(
    Effect.gen(function* () {
      yield* (yield* Cache).invalidate(key);
    }),
  );
