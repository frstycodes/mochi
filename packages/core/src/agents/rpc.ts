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
  /** Codex's `thread_history` call, which main's loopback MCP server takes; answered from Core's log. */
  Rpc.make('agentThreadHistory', {
    payload: { threadId: Schema.String, args: Schema.Unknown },
    success: Schema.Unknown,
  }),
  /** Codex's pattern-kill hook input, which main's loopback route takes; the hook's stdout, or null to let it run. */
  Rpc.make('agentKillHook', {
    payload: { input: Schema.Unknown },
    success: Schema.Unknown,
  }),
  /** Main's detection saw this account's login. */
  Rpc.make('agentNoteLogin', {
    payload: { accountId: Schema.String, login: Schema.Unknown },
  }),
) {}
