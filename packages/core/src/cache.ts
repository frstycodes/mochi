import {
  Cache as EffectCache,
  Context,
  Duration,
  Effect,
  Equal,
  Exit,
  Hash,
  Layer,
} from 'effect';

/** One shared TTL cache: callers bring the key, the lookup and how long a success stays fresh. Failures aren't kept. */
export class Cache extends Context.Service<Cache>()('mochi/core/Cache', {
  make: Effect.gen(function* () {
    const cache = yield* EffectCache.makeWith((entry: Entry) => entry.lookup, {
      capacity: 1024,
      timeToLive: (exit, entry) =>
        Exit.isSuccess(exit) ? entry.ttl : Duration.zero,
    });
    const get = <A, E>(
      key: string,
      lookup: Effect.Effect<A, E>,
      ttl: Duration.Input,
    ) =>
      EffectCache.get(cache, new Entry(key, lookup, ttl)) as Effect.Effect<
        A,
        E
      >;
    const invalidate = (key: string) =>
      EffectCache.invalidate(cache, new Entry(key, Effect.void, 0));
    return { get, invalidate };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** Equal by `key` alone, so the lookup and TTL ride along without splitting the entry. */
class Entry implements Equal.Equal {
  readonly key: string;
  readonly lookup: Effect.Effect<unknown, unknown>;
  readonly ttl: Duration.Input;
  constructor(
    key: string,
    lookup: Effect.Effect<unknown, unknown>,
    ttl: Duration.Input,
  ) {
    this.key = key;
    this.lookup = lookup;
    this.ttl = ttl;
  }
  [Equal.symbol](that: unknown) {
    return that instanceof Entry && that.key === this.key;
  }
  [Hash.symbol]() {
    return Hash.string(this.key);
  }
}
