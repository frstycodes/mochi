import { Schema } from 'effect';
import { Rpc, RpcGroup, RpcMiddleware } from 'effect/rpc';
import {
  Agent,
  Backend,
  Capabilities,
  HostRpcs,
  Model,
  Relay,
  Remote,
} from '@mochi/schema';
import { StoreRpcs } from './store/rpc.ts';
import { Gate, StaleKind, WatchKey, WatchValue } from './watch/keys.ts';
import { GithubRpcs } from './github/schema.ts';
import { AgentRpcs } from './agents/rpc.ts';
import { DeviceRpcs } from './remote/rpc.ts';
import { MetricsRpcs } from './metrics/schema.ts';
import { TerminalRpcs } from './remote/terminals.ts';
import { ScheduleRpcs } from './schedule/rpc.ts';

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

/** A member computer main follows (`remote/registry.ts`). */
const PairedMachine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.optional(Relay.DeviceKind),
  publicKey: Schema.String,
  pairedAt: Schema.Number,
  addresses: Schema.optional(Schema.Array(Schema.String)),
});

const SpawnEvent = Schema.Union([
  Schema.TaggedStruct('started', { id: Schema.Number }),
  Schema.TaggedStruct('out', {
    stream: Schema.Literals(['stdout', 'stderr']),
    data: Schema.Uint8Array,
  }),
  Schema.TaggedStruct('exit', {
    code: Schema.NullOr(Schema.Number),
    timedOut: Schema.optional(Schema.Boolean),
  }),
]);

// GAP: local until `packages/schema/rpc.ts` lands; the `schema` and `rpc-client` sessions move these there.
export class CoreRpcs extends RpcGroup.make(
  Rpc.make('ping', { success: Schema.String }),
  Rpc.make('ticks', {
    payload: { intervalMs: Schema.Number },
    success: Schema.Number,
    stream: true,
  }),
  Rpc.make('log', {
    payload: {
      level: Schema.Literals(['Debug', 'Info', 'Warn', 'Error']),
      source: Schema.String,
      message: Schema.String,
    },
  }),
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
    success: Schema.Struct({
      stdout: Schema.String,
      stderr: Schema.String,
      code: Schema.Number,
    }),
    error: RunError,
  }),
  Rpc.make('spawn', {
    payload: {
      command: Schema.String,
      args: Schema.Array(Schema.String),
      cwd: Schema.optional(Schema.String),
      env: Schema.optional(Env),
      shell: Schema.optional(Schema.Boolean),
      timeoutMs: Schema.optional(Schema.Number),
    },
    success: SpawnEvent,
    error: RunError,
    stream: true,
  }),
  Rpc.make('stdin', {
    payload: { id: Schema.Number, data: Schema.NullOr(Schema.Uint8Array) },
  }),
  Rpc.make('signal', { payload: { id: Schema.Number, signal: Schema.String } }),
  // The utility model's queue. `thread` + task make the replace-older key; leave `thread` out for a one-off.
  Rpc.make('utility.run', {
    payload: {
      task: Agent.UtilityTask,
      spaceId: Schema.String,
      prompt: Schema.String,
      thread: Schema.optional(Schema.String),
    },
    success: Schema.NullOr(Schema.String),
  }),
  Rpc.make('utility.classify', {
    payload: { prompt: Schema.String, thread: Model.Thread },
    success: Schema.NullOr(Agent.DriftVerdict),
  }),
  /** This Core's descriptor as this connection sees it. */
  Rpc.make('backend.info', { success: Backend.BackendInfo }),
  /** The descriptor now, then again whenever it changes. */
  Rpc.make('backend.watch', { success: Backend.BackendInfo, stream: true }),
  /** Main tells Core the id and name it registered for this machine; local only. */
  Rpc.make('backend.identify', {
    payload: {
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
    },
  }),
  Rpc.make('capabilities.serve', {
    payload: { names: Schema.Array(Capabilities.CapabilityName) },
    success: Capabilities.CapabilityCall,
    stream: true,
  }),
  Rpc.make('capabilities.reply', { payload: Capabilities.CapabilityReply }),
  Rpc.make('watch', {
    payload: { key: WatchKey },
    success: WatchValue,
    stream: true,
  }),
  /** Main's report of window visibility, sleep and power source. */
  Rpc.make('watch.gate', { payload: Gate }),
  /** Every subscribed key of these kinds reads again, gate permitting. */
  Rpc.make('watch.stale', { payload: { kinds: Schema.Array(StaleKind) } }),
  /** An access token for the relay, for main's remote access; refused to a window's or a device's connection. */
  Rpc.make('account.relayToken', {
    success: Schema.String,
    error: Schema.String,
  }),
  // Main's, for following your other computers as a device (electron/remote); each refused to a window's or a device's connection.
  /** This computer's member key, its seed in base64: main pairs with it as a device. */
  Rpc.make('remote.deviceKey', {
    success: Schema.String,
    error: Schema.String,
  }),
  /** The machines main follows and the records it sends them; each change also arrives as the `remote:onPaired` push. */
  Rpc.make('remote.paired', {
    success: Schema.Struct({
      machines: Schema.Array(PairedMachine),
      records: Schema.Unknown,
      nearby: Schema.Record(Schema.String, Schema.String),
    }),
    error: Schema.String,
  }),
  /** A followed machine's membership records; none fetches the account's, as after it refused this computer. */
  Rpc.make('remote.absorb', {
    payload: { members: Schema.optional(Schema.Unknown) },
    error: Schema.String,
  }),
  /** Where a followed machine said it listens, and its kind, from its welcome. */
  Rpc.make('remote.noteWelcome', {
    payload: {
      machineId: Schema.String,
      addresses: Schema.optional(Schema.Array(Schema.String)),
      kind: Schema.optional(Relay.DeviceKind),
    },
    error: Schema.String,
  }),
  /**
   * `mochi login` following a headless Core's join (`Remote.joinAlone`): each computer asked with its code, then how it
   * ended. Refused to a window's or a device's connection, like main's.
   */
  Rpc.make('remote.joinAlone', {
    success: Schema.Union([
      Schema.Struct({
        type: Schema.Literal('asking'),
        machineName: Schema.String,
        name: Schema.String,
        code: Schema.String,
      }),
      Schema.Struct({
        type: Schema.Literal('declined'),
        machineName: Schema.String,
        reason: Schema.String,
      }),
      Schema.Struct({
        type: Schema.Literal('joined'),
        machineName: Schema.String,
      }),
      Schema.Struct({ type: Schema.Literal('member') }),
      Schema.Struct({ type: Schema.Literal('failed'), reason: Schema.String }),
    ]),
    error: Schema.String,
    stream: true,
  }),
  /** What only main knows, for `host.remote.status`: the power source, and each followed machine's connection. */
  Rpc.make('remote.shell', {
    payload: {
      isOnBattery: Schema.Boolean,
      machines: Schema.Array(Remote.FollowedMachine),
    },
    error: Schema.String,
  }),
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { scope: Capabilities.AuthScope },
) {
  override get message() {
    return `This connection lacks the ${this.scope} scope`;
  }
}

/** Refuses an RPC whose `scopeOf` scope the connection's token doesn't carry. */
export class ScopeAuthorization extends RpcMiddleware.Service<ScopeAuthorization>()(
  'mochi/core/ScopeAuthorization',
  { error: Unauthorized },
) {}

/** Everything served on Core's WebSocket. */
export class CoreWsRpcs extends CoreRpcs.merge(
  HostRpcs,
  StoreRpcs,
  GithubRpcs,
  AgentRpcs,
  DeviceRpcs,
  MetricsRpcs,
  TerminalRpcs,
  ScheduleRpcs,
).middleware(ScopeAuthorization) {}
