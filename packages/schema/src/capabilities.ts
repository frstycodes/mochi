import { Schema } from 'effect';
import { invoke, Str } from './checks.ts';
import { COMMAND_SCOPES, type RemoteCommand } from './relay.ts';

/** Core refuses a WebSocket upgrade whose `v` differs, with HTTP 426. Bump on any breaking change to Core's RPCs. */
export const PROTOCOL_VERSION = 2;

/**
 * Core reads a client's token from the WebSocket subprotocols it offers, never the URL: it offers `mochi` and
 * `mochi.token.<token>`, and Core answers with `mochi` alone. A browser can set subprotocols but not headers.
 */
export const SUBPROTOCOL = 'mochi';
const TOKEN_PREFIX = 'mochi.token.';
export const subprotocolsFor = (token: string) => [
  SUBPROTOCOL,
  `${TOKEN_PREFIX}${token}`,
];
/** The token in a `Sec-WebSocket-Protocol` header, if one is offered. */
export const tokenFromSubprotocols = (header: string | undefined) =>
  header
    ?.split(',')
    .map((p) => p.trim())
    .find((p) => p.startsWith(TOKEN_PREFIX))
    ?.slice(TOKEN_PREFIX.length);

/**
 * The remote member scopes, and `local`: everything only this computer's own windows and main may do. A paired device's
 * token never carries `local`. A token carries some of them; every RPC needs one (`scopeOf`).
 */
export const AuthScope = Schema.Literals([
  'read',
  'operate',
  'manage',
  'code',
  'terminal',
  'local',
]);
export type AuthScope = typeof AuthScope.Type;
export const allScopes = AuthScope.literals;

/**
 * What a client can do for Core that Core can't: show OS notifications, own browser-pane views, reach `safeStorage`,
 * drive simulators. `host` is every `host.*` namespace whose handler still lives in main; it shrinks as they move into Core.
 * `remote` runs a device's command (`device.command`) in the window that owns the store, until Core owns it.
 * `reactor` runs the reactor's commands (`packages/core/src/reactor/commands.ts`) in the window that owns the store, until Core owns it.
 * `main` is what Core's agents ask of main (`MainForAgents` in packages/core/src/agents/main.ts), not a `host.*` namespace.
 */
export const CapabilityName = Schema.Literals([
  'notify',
  'browserView',
  'secureStorage',
  'sim',
  'host',
  'remote',
  'metrics',
  'main',
  'reactor',
]);
export type CapabilityName = typeof CapabilityName.Type;

/**
 * No connected client serves `capability`: main is restarting, or Core runs headless (`mochi serve`), where the desktop's
 * capabilities (notifications, browser views, the keychain, simulators, main's `host.*` handlers) don't exist.
 */
export class CapabilityUnavailable extends Schema.TaggedError<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: CapabilityName },
) {
  override get message() {
    return `No connected client offers ${this.capability}`;
  }
}

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
export const CapabilityReply = Schema.Struct({
  id: Schema.Number,
  value: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});
export type CapabilityReply = typeof CapabilityReply.Type;

/** `safeStorage`, base64 in and out. Nothing in Core calls it yet; it is here so the capability has a contract. */
export const secureStorageMethods = {
  encrypt: invoke(Schema.Tuple([Str(1_000_000)]), Schema.String),
  decrypt: invoke(Schema.Tuple([Str(1_400_000)]), Schema.String),
};

/** One process of `app.getAppMetrics()`. `cpuSeconds` is the process's cumulative CPU time, so two samples give a rate that doesn't depend on Electron's sampling window. */
export const ProcessMetric = Schema.Struct({
  pid: Schema.Number,
  type: Schema.String,
  name: Schema.optionalKey(Schema.String),
  cpuPercent: Schema.Number,
  cpuSeconds: Schema.Number,
  workingSetKb: Schema.Number,
  privateKb: Schema.optionalKey(Schema.Number),
});
export type ProcessMetric = typeof ProcessMetric.Type;

/** What main reports for the developer page. */
export const metricsMethods = {
  processes: invoke(Schema.Tuple([]), Schema.Array(ProcessMetric)),
};

/** The capability that serves `host.<namespace>.*`. */
export const capabilityOf = (namespace: string): CapabilityName =>
  namespace === 'notify'
    ? 'notify'
    : namespace === 'browser'
      ? 'browserView'
      : namespace === 'sim'
        ? 'sim'
        : 'host';

/** What a paired device may call besides `device.command`. `terminal.output` pushes a shell's output. */
const deviceScopes: Record<string, AuthScope> = {
  ping: 'read',
  shell: 'read',
  thread: 'read',
  'terminal.output': 'terminal',
};

/**
 * The scope an RPC needs: a device command's by its type, the few reads a device makes, and `local` for everything else,
 * so a new procedure stays closed to devices until it is classified here.
 */
export const scopeOf = (tag: string, payload?: unknown): AuthScope =>
  tag === 'device.command'
    ? (COMMAND_SCOPES[
        (payload as { command?: { type?: RemoteCommand['type'] } } | undefined)
          ?.command?.type!
      ] ?? 'local')
    : (deviceScopes[tag] ?? 'local');
