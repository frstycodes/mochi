import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Capabilities } from '@mochi/schema';

// No node built-ins here: the developer page imports it through rpc.ts.

export const SpawnRate = Schema.Struct({ binary: Schema.String, perMinute: Schema.Number });
export const WatchSubscription = Schema.Struct({
  kind: Schema.String,
  /** The key's path, when it has one. */
  target: Schema.NullOr(Schema.String),
  subscribers: Schema.Number,
  /** How often it reads now; null when it reads only on change, or the machine is asleep. */
  intervalMs: Schema.NullOr(Schema.Number),
});
export const ThreadEventRate = Schema.Struct({ threadId: Schema.String, perSecond: Schema.Number });
export const SpanRecord = Schema.Struct({ name: Schema.String, durationMs: Schema.Number, endedAt: Schema.Number, isOk: Schema.Boolean });

/** One second of Core's own numbers plus main's `app.getAppMetrics()`. */
export const MetricsSnapshot = Schema.Struct({
  at: Schema.Number,
  /** Empty while no client serves the `metrics` capability. */
  processes: Schema.Array(Capabilities.ProcessMetric),
  spawns: Schema.Array(SpawnRate),
  watches: Schema.Array(WatchSubscription),
  /** Events in the last ten seconds, per thread. */
  events: Schema.Array(ThreadEventRate),
  /** Newest first. */
  spans: Schema.Array(SpanRecord),
  logFile: Schema.NullOr(Schema.String),
});
export type MetricsSnapshot = typeof MetricsSnapshot.Type;

export class MetricsRpcs extends RpcGroup.make(Rpc.make('metrics', { success: MetricsSnapshot, stream: true })) {}
