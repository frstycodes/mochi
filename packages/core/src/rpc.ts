import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { RunError } from './run.ts';

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
) {}
