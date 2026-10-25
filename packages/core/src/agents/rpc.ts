import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

/** Main's side of the agents service: the push stream it relays to its windows, and the two things only main knows. */
export class AgentRpcs extends RpcGroup.make(
  Rpc.make('agentPush', {
    success: Schema.Struct({
      channel: Schema.String,
      payload: Schema.Unknown,
      windowId: Schema.optional(Schema.Number),
    }),
    stream: true,
  }),
  /** An event main made (a notification's Allow/Deny resolved a request), logged and sent like the agents' own. */
  Rpc.make('agentEmit', { payload: { event: Schema.Unknown } }),
  /** Main's detection saw this account's login. */
  Rpc.make('agentNoteLogin', {
    payload: { accountId: Schema.String, login: Schema.Unknown },
  }),
) {}
