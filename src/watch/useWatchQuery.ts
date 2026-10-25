import { useQuery, type QueryKey } from '@tanstack/react-query';
import { Effect, Schedule, Stream } from 'effect';
import { useEffect } from 'react';
import type { StaleKind, WatchKey, WatchValue } from '@mochi/core/watch/keys';
import { host } from '../host/index.ts';
import { coreClient } from '../host/desktop/rpc.ts';
import { queryClient } from '../query.ts';

type Tag = WatchKey['_tag'];
type KeyOf<K extends Tag> = Extract<WatchKey, { _tag: K }>;
type ValueOf<K extends Tag> = Extract<WatchValue, { _tag: K }>;

const STALE_KIND = { files: 'files', changes: 'files', gitDiff: 'git', ports: 'ports', sim: 'sim' } satisfies Record<Tag, StaleKind>;

/**
 * A query Core keeps current. On desktop, `key`'s watch stream writes it with `setQueryData` (one stream per query per
 * window, however many components read it) and nothing polls; in the web build, `read` fetches it once. `pick` takes the
 * data out of a stream value. `refresh` asks Core to read again (desktop) or refetches (web).
 */
export function useWatchQuery<K extends Tag, T>(queryKey: QueryKey, key: KeyOf<K> | null, pick: (value: ValueOf<K>) => T, read: () => Promise<T>) {
  const id = JSON.stringify(queryKey);
  useEffect(() => {
    if (!key) return;
    return follow(id, queryKey, key, pick as (value: WatchValue) => unknown);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `id` stands for `queryKey`, and a watch key is a function of its query key; `pick` is per call site, not per render
  }, [id]);
  const query = useQuery({ queryKey, queryFn: read, enabled: !!key && !host.isDesktop, staleTime: host.isDesktop ? Infinity : undefined });
  const refresh = async () => {
    if (!key) return;
    if (host.isDesktop) return markStale([STALE_KIND[key._tag]]);
    await query.refetch();
  };
  return [query, refresh] as const;
}

/** Asks Core to read every subscribed key of these kinds again. */
export async function markStale(kinds: StaleKind[]) {
  if (!host.isDesktop) return;
  const core = await coreClient();
  await Effect.runPromise(core['watch.stale']({ kinds }));
}

/** `onValue` for each of `key`'s values until the returned function is called; nothing in the web build. */
export function watchKey(key: WatchKey, onValue: (value: WatchValue) => void) {
  if (!host.isDesktop) return () => {};
  const abort = new AbortController();
  const subscribe = Effect.promise(() => coreClient()).pipe(
    Effect.flatMap((core) => Stream.runForEach(core.watch({ key }), (value) => Effect.sync(() => onValue(value)))),
    // The stream ends with the socket; Core replays the key's current value to the subscription after the redial.
    Effect.ignore,
    Effect.repeat(Schedule.spaced(1000)),
  );
  void Effect.runPromise(subscribe, { signal: abort.signal }).catch(() => {});
  return () => abort.abort();
}

const streams = new Map<string, { users: number; stop: () => void }>();

function follow(id: string, queryKey: QueryKey, key: WatchKey, pick: (value: WatchValue) => unknown) {
  const running = streams.get(id) ?? { users: 0, stop: watchKey(key, (value) => write(queryKey, value, pick)) };
  running.users++;
  streams.set(id, running);
  return () => {
    if (--running.users > 0) return;
    running.stop();
    streams.delete(id);
  };
}

function write(queryKey: QueryKey, value: WatchValue, pick: (value: WatchValue) => unknown) {
  if (value._tag !== 'error') return void queryClient.setQueryData(queryKey, pick(value));
  queryClient.getQueryCache().build(queryClient, { queryKey }).setState({ status: 'error', error: new Error(value.message), errorUpdatedAt: Date.now() });
}
