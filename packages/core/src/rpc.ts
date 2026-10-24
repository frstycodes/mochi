import { Schema } from 'effect';
import { Rpc, RpcGroup, RpcMiddleware } from 'effect/rpc';
import { Agent, Capabilities, HostRpcs, Model } from '@mochi/schema';
import { StoreRpcs } from './store/rpc.ts';
import { Gate, StaleKind, WatchKey, WatchValue } from './watch/keys.ts';
import { GithubRpcs } from './github/schema.ts';
import { AgentRpcs } from './agents/rpc.ts';
import { DeviceRpcs } from './remote/rpc.ts';
import { MetricsRpcs } from './metrics/schema.ts';
import { TerminalRpcs } from './remote/terminals.ts';

// Here rather than in run.ts so a window's client imports no node built-ins.
export class RunError extends Schema.TaggedError<RunError>()('RunError', {
  command: Schema.String,
  /** `-1` when the process never produced an exit code: it failed to start or timed out. */
  code: Schema.Number,
  stderr: Schema.String,
  /** What it printed before failing; some tools report on stdout and exit non-zero. */
  stdout: Schema.optional(Schema.String),
  timedOut: Schema.optional(Schema.Boolean),
}) {}

const Env = Schema.Record(Schema.String, Schema.String);

const SpawnEvent = Schema.Union([
  Schema.TaggedStruct('started', { id: Schema.Number }),
  Schema.TaggedStruct('out', { stream: Schema.Literals(['stdout', 'stderr']), data: Schema.Uint8Array }),
  Schema.TaggedStruct('exit', { code: Schema.NullOr(Schema.Number), timedOut: Schema.optional(Schema.Boolean) }),
]);

// GAP: local until `packages/schema/rpc.ts` lands; the `schema` and `rpc-client` sessions move these there.
export class CoreRpcs extends RpcGroup.make(
  Rpc.make('ping', { success: Schema.String }),
  Rpc.make('ticks', { payload: { intervalMs: Schema.Number }, success: Schema.Number, stream: true }),
  Rpc.make('log', { payload: { level: Schema.Literals(['Debug', 'Info', 'Warn', 'Error']), source: Schema.String, message: Schema.String } }),
  Rpc.make('run', {
    payload: {
      command: Schema.String,
      args: Schema.Array(Schema.String),
      cwd: Schema.optional(Schema.String),
      env: Schema.optional(Env),
      input: Schema.optional(Schema.String),
      timeoutMs: Schema.optional(Schema.Number),
      okCodes: Schema.optional(Schema.Array(Schema.Number)),
      queue: Schema.optional(Schema.String),
      shell: Schema.optional(Schema.Boolean),
    },
    success: Schema.Struct({ stdout: Schema.String, stderr: Schema.String, code: Schema.Number }),
    error: RunError,
  }),
  Rpc.make('spawn', {
    payload: { command: Schema.String, args: Schema.Array(Schema.String), cwd: Schema.optional(Schema.String), env: Schema.optional(Env), shell: Schema.optional(Schema.Boolean), timeoutMs: Schema.optional(Schema.Number) },
    success: SpawnEvent,
    error: RunError,
    stream: true,
  }),
  Rpc.make('stdin', { payload: { id: Schema.Number, data: Schema.NullOr(Schema.Uint8Array) } }),
  Rpc.make('signal', { payload: { id: Schema.Number, signal: Schema.String } }),
  // The utility model's queue. `thread` + task make the replace-older key; leave `thread` out for a one-off.
  Rpc.make('utility.run', { payload: { task: Agent.UtilityTask, spaceId: Schema.String, prompt: Schema.String, thread: Schema.optional(Schema.String) }, success: Schema.NullOr(Schema.String) }),
  Rpc.make('utility.classify', { payload: { prompt: Schema.String, thread: Model.Thread }, success: Schema.NullOr(Agent.DriftVerdict) }),
  Rpc.make('capabilities.serve', { payload: { names: Schema.Array(Capabilities.CapabilityName) }, success: Capabilities.CapabilityCall, stream: true }),
  Rpc.make('capabilities.reply', { payload: Capabilities.CapabilityReply }),
  Rpc.make('watch', { payload: { key: WatchKey }, success: WatchValue, stream: true }),
  /** Main's report of window visibility, sleep and power source. */
  Rpc.make('watch.gate', { payload: Gate }),
  /** Every subscribed key of these kinds reads again, gate permitting. */
  Rpc.make('watch.stale', { payload: { kinds: Schema.Array(StaleKind) } }),
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', { scope: Capabilities.AuthScope }) {
  override get message() {
    return `This connection lacks the ${this.scope} scope`;
  }
}

/** Refuses an RPC whose `scopeOf` scope the connection's token doesn't carry. */
export class ScopeAuthorization extends RpcMiddleware.Service<ScopeAuthorization>()('mochi/core/ScopeAuthorization', { error: Unauthorized }) {}

/** Everything served on Core's WebSocket. */
export class CoreWsRpcs extends CoreRpcs.merge(HostRpcs, StoreRpcs, GithubRpcs, AgentRpcs, DeviceRpcs, MetricsRpcs, TerminalRpcs).middleware(ScopeAuthorization) {}
