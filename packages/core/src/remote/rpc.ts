import { Rpc, RpcGroup } from 'effect/rpc';
import { Schema } from 'effect';
import { Relay } from '@mochi/schema';

/** A paired device's commands: each needs its type's scope (`COMMAND_SCOPES`), checked by `ScopeAuthorization`. */
export class DeviceRpcs extends RpcGroup.make(
  Rpc.make('device.command', {
    payload: {
      command: Relay.RemoteCommand,
      commandId: Schema.optional(Schema.String),
    },
    success: Relay.CommandResult,
  }),
) {}
