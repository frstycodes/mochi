import { Effect, Stream } from 'effect';
import { connectedCore } from '@mochi/core/runClient';
import type { WatchKey, WatchValue } from '@mochi/core/watch/keys';

// No `electron` import: electron/browser/reload.ts uses this, and its tests run under plain node.

/** `key`'s values from Core's watch service, for main's own subscribers, until the returned function is called. */
export function watchFromMain(
  key: WatchKey,
  onValue: (value: WatchValue) => void,
) {
  const abort = new AbortController();
  void callCore(
    (core) =>
      Stream.runForEach(core.watch({ key }), (value) =>
        Effect.sync(() => onValue(value)),
      ),
    abort.signal,
  );
  return () => abort.abort();
}

type Core = NonNullable<Awaited<ReturnType<typeof connectedCore>>>;

// GAP: before main's first connection to Core these are dropped, and a watch started then never starts.
export async function callCore(
  f: (core: Core) => Effect.Effect<unknown, unknown>,
  signal?: AbortSignal,
) {
  const core = await connectedCore();
  if (!core) return;
  await Effect.runPromise(f(core), { signal }).catch(() => {});
}
