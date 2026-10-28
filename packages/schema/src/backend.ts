import { Schema } from 'effect';
import { AuthScope, CapabilityName } from './names.ts';

/** `server` is `mochi serve`: headless, so it never takes the OS kind (a Linux box running it still says `server`). */
export const BackendKind = Schema.Literals([
  'mac',
  'windows',
  'linux',
  'server',
]);
export type BackendKind = typeof BackendKind.Type;

/**
 * What a Core says about itself: `backend.info` answers it and `backend.watch` pushes it again when it changes.
 * `capabilities` is what Core can serve now, from the clients connected to it; `scopes` is this connection's.
 */
export const BackendInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: BackendKind,
  appVersion: Schema.String,
  protocolVersion: Schema.Number,
  capabilities: Schema.Array(CapabilityName),
  scopes: Schema.Array(AuthScope),
});
export type BackendInfo = typeof BackendInfo.Type;
