import { Clock, Context, Effect, Layer, Schedule, Stream } from 'effect';
import { Capabilities as Contract } from '@mochi/schema';
import { Capabilities } from '../hostServer.ts';
import { Run } from '../run.ts';
import { Store } from '../store/store.ts';
import { Watch } from '../watch/watch.ts';
import type { MetricsSnapshot } from './schema.ts';
import { recentSpans } from './spans.ts';

const SAMPLE_MS = 1_000;
const SPAWN_WINDOW_MS = 60_000;
const EVENT_WINDOW_MS = 10_000;

/** Core's numbers for the developer page, sampled once a second while someone watches. */
export class Metrics extends Context.Service<Metrics>()('mochi/core/Metrics', {
  make: Effect.gen(function* () {
    const run = yield* Run;
    const store = yield* Store;
    const watch = yield* Watch;
    const capabilities = yield* Capabilities;
    const spawned: { at: number; binary: string }[] = [];
    const logged: { at: number; threadId: string }[] = [];

    // Pruned on read: the windows are small and the page is the only reader.
    yield* Stream.runForEach(run.spawns, (binary) => Effect.sync(() => spawned.push({ at: Date.now(), binary: binary.split('/').pop()! }))).pipe(Effect.forkScoped);
    yield* Stream.runForEach(store.events, (event) => Effect.sync(() => event.threadId && logged.push({ at: Date.now(), threadId: event.threadId }))).pipe(Effect.forkScoped);

    const processes = capabilities.call({ capability: 'metrics', method: 'processes', args: [] }).pipe(
      Effect.map((value) => value as ReadonlyArray<Contract.ProcessMetric>),
      // No window has registered yet, or main is restarting: the page shows Core's side alone.
      Effect.orElseSucceed(() => [] as ReadonlyArray<Contract.ProcessMetric>),
    );

    const sample = Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      drop(spawned, at - SPAWN_WINDOW_MS);
      drop(logged, at - EVENT_WINDOW_MS);
      const watches = (yield* watch.subscriptions).map(({ key, subscribers, intervalMs }) => ({
        kind: key._tag,
        target: 'root' in key ? key.root : 'cwd' in key ? key.cwd : null,
        subscribers,
        intervalMs,
      }));
      return {
        at,
        processes: yield* processes,
        spawns: [...countBy(spawned, (s) => s.binary)].map(([binary, perMinute]) => ({ binary, perMinute })).sort((a, b) => b.perMinute - a.perMinute),
        watches,
        events: [...countBy(logged, (e) => e.threadId)].map(([threadId, count]) => ({ threadId, perSecond: count / (EVENT_WINDOW_MS / 1000) })).sort((a, b) => b.perSecond - a.perSecond),
        spans: recentSpans(),
        logFile: process.env.MOCHI_LOG_FILE ?? null,
      } satisfies MetricsSnapshot;
    });

    /** A sample now, then one a second. */
    const stream = Stream.fromEffect(sample).pipe(Stream.repeat(Schedule.spaced(SAMPLE_MS)));
    return { sample, stream };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

function drop(items: { at: number }[], before: number) {
  const keep = items.findIndex((item) => item.at >= before);
  items.splice(0, keep === -1 ? items.length : keep);
}

function countBy<A>(items: ReadonlyArray<A>, key: (item: A) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}
