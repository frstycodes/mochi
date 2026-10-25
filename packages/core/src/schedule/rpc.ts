import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

/** Main's side of the scheduler: the changes it hands to its windows, and the events it had no window for. */
export class ScheduleRpcs extends RpcGroup.make(
  Rpc.make('schedule.watch', { success: Schema.Unknown, stream: true }),
  Rpc.make('schedule.keep', { payload: { event: Schema.Unknown } }),
) {}
