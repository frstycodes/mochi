import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

// GAP: local until `packages/schema/rpc.ts` lands; the `schema` and `rpc-client` sessions move these there.
export class CoreRpcs extends RpcGroup.make(
  Rpc.make('ping', { success: Schema.String }),
  Rpc.make('ticks', { payload: { intervalMs: Schema.Number }, success: Schema.Number, stream: true }),
  Rpc.make('log', { payload: { level: Schema.Literals(['Debug', 'Info', 'Warn', 'Error']), source: Schema.String, message: Schema.String } }),
) {}
