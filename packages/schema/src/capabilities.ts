import { Schema } from 'effect';
import { invoke, Str } from './checks.ts';

/** Core refuses a WebSocket upgrade whose `v` differs, with HTTP 426. Bump on any breaking change to Core's RPCs. */
export const PROTOCOL_VERSION = 1;

/** The remote member scopes. A token carries some of them; every RPC needs one (`scopeOf`). */
export const AuthScope = Schema.Literals(['read', 'operate', 'manage', 'code', 'terminal']);
export type AuthScope = typeof AuthScope.Type;
export const allScopes = AuthScope.literals;

/**
 * What a client can do for Core that Core can't: show OS notifications, own browser-pane views, reach `safeStorage`,
 * drive simulators. `host` is every `host.*` namespace whose handler still lives in main; it shrinks as they move into Core.
 */
export const CapabilityName = Schema.Literals(['notify', 'browserView', 'secureStorage', 'sim', 'host']);
export type CapabilityName = typeof CapabilityName.Type;

/** Core → the client that registered `capability`. `args` and the reply's `value` are JSON-encoded with the method's schema. */
export const CapabilityCall = Schema.Struct({
  id: Schema.Number,
  capability: CapabilityName,
  method: Schema.String,
  args: Schema.Array(Schema.Unknown),
  /** The window that made the call, when one did: main's handlers act on their sender. */
  windowId: Schema.optional(Schema.Number),
});
export type CapabilityCall = typeof CapabilityCall.Type;

/** `error` set means the call failed with that message. */
export const CapabilityReply = Schema.Struct({ id: Schema.Number, value: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.String) });
export type CapabilityReply = typeof CapabilityReply.Type;

/** `safeStorage`, base64 in and out. Nothing in Core calls it yet; it is here so the capability has a contract. */
export const secureStorageMethods = {
  encrypt: invoke(Schema.Tuple([Str(1_000_000)]), Schema.String),
  decrypt: invoke(Schema.Tuple([Str(1_400_000)]), Schema.String),
};

/** The capability that serves `host.<namespace>.*`. */
export const capabilityOf = (namespace: string): CapabilityName =>
  namespace === 'notify' ? 'notify' : namespace === 'browser' ? 'browserView' : namespace === 'sim' ? 'sim' : 'host';

const hostScopes: Record<string, AuthScope> = {
  pty: 'terminal',
  fs: 'code',
  git: 'code',
  settings: 'manage',
  account: 'manage',
  remote: 'manage',
  library: 'manage',
  data: 'manage',
};

const coreScopes: Record<string, AuthScope> = {
  ping: 'read',
  ticks: 'read',
  log: 'operate',
  run: 'terminal',
  spawn: 'terminal',
  stdin: 'terminal',
  signal: 'terminal',
  'capabilities.serve': 'manage',
  'capabilities.reply': 'manage',
  watch: 'code',
  'watch.gate': 'manage',
  'watch.stale': 'operate',
};

// GAP: per-namespace, not per-method; `remote-core` refines it when scoped device tokens exist.
/** The scope an RPC tag needs. Unknown tags need `manage`, so a new procedure is closed until it is classified. */
export const scopeOf = (tag: string): AuthScope => coreScopes[tag] ?? (tag.includes('.') ? (hostScopes[tag.split('.')[0]!] ?? 'operate') : 'manage');
