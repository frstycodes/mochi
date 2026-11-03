import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

/** Main's side of the scheduler: the trigger changes it hands to its windows. */
export class ScheduleRpcs extends RpcGroup.make(
  Rpc.make('schedule.watch', { success: Schema.Unknown, stream: true }),
) {}
