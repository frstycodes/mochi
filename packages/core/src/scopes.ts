import type { RpcGroup } from 'effect/rpc';
import { Capabilities, HOST_SCOPES, Relay } from '@mochi/schema';
import type { AgentRpcs } from './agents/rpc.ts';
import type { GithubRpcs } from './github/schema.ts';
import type { MetricsRpcs } from './metrics/schema.ts';
import type { DeviceRpcs } from './remote/rpc.ts';
import type { TerminalRpcs } from './remote/terminals.ts';
import type { CoreRpcs } from './rpc.ts';
import type { ScheduleRpcs } from './schedule/rpc.ts';
import type { StoreRpcs } from './store/rpc.ts';

type Tags<Group> = RpcGroup.Rpcs<Group>['_tag'];

/** Core's own tags; `host.*` are `HOST_SCOPES`. A group added to `CoreWsRpcs` joins this union, or `scopes.test.ts` fails. */
export type CoreTag =
  | Tags<typeof CoreRpcs>
  | Tags<typeof StoreRpcs>
  | Tags<typeof GithubRpcs>
  | Tags<typeof AgentRpcs>
  | Tags<typeof MetricsRpcs>
  | Tags<typeof TerminalRpcs>
  | Tags<typeof ScheduleRpcs>
  | Exclude<Tags<typeof DeviceRpcs>, 'device.command'>;

const L = 'local';

/**
 * One scope per tag, every tag listed, so a new RPC fails to compile until it is classified. `local` for what takes a path,
 * runs a process, writes the store raw, or is main's or a window's side of Core; a device reaches those through
 * `device.command`. When unsure, the stricter scope.
 */
export const CORE_SCOPES = {
  ping: 'read',
  ticks: L,
  log: L,
  // Any command, any cwd: a device's shell is `terminal-open`, in the thread's folder.
  run: L,
  spawn: L,
  stdin: L,
  signal: L,
  // This machine's utility model on the caller's prompt.
  'utility.run': L,
  'backend.info': 'read',
  'backend.watch': 'read',
  'backend.identify': L,
  // Serving a capability would let a device answer for main.
  'capabilities.serve': L,
  'capabilities.reply': L,
  // Main's: the account's relay token, this computer's member key, and the machines it follows and their records.
  'account.relayToken': L,
  'remote.deviceKey': L,
  'remote.paired': L,
  'remote.absorb': L,
  'remote.noteWelcome': L,
  'remote.shell': L,
  // `mochi login` following a headless join: the pairing codes it shows.
  'remote.joinAlone': L,
  // Keys are roots and cwds the caller names.
  watch: L,
  'watch.gate': L,
  'watch.stale': L,
  // Filtered per scope in the handler (`visibleItem`, `visibleReplica`).
  shell: 'read',
  thread: 'read',
  replica: 'read',
  // Raw writes past every command and scope.
  'events.append': L,
  'docs.list': L,
  'docs.get': L,
  'docs.set': L,
  // A cwd the caller names, and the gh login to ask as.
  'github.pr': L,
  'github.ci': L,
  'github.ref': L,
  'github.openPrs': L,
  'github.authoredPrs': L,
  'github.refresh': L,
  // The agents' side of Core: main's MCP server, hooks and login detection.
  agentPush: L,
  agentEmit: L,
  agentThreadHistory: L,
  agentKillHook: L,
  agentNoteLogin: L,
  // Every process on this machine.
  metrics: L,
  // The window's pty feeding a device's shell; the device reads it with `terminal.output`.
  'terminal.open': L,
  'terminal.feed': L,
  'terminal.exit': L,
  'terminal.close': L,
  'terminal.watched': L,
  'terminal.output': 'terminal',
  // Every trigger's folder and start options; main's handoff of events no window took.
  'schedule.watch': L,
  'schedule.keep': L,
} as const satisfies Record<CoreTag, Capabilities.AuthScope>;

const hostScope = (tag: string): Capabilities.AuthScope | undefined => {
  const dot = tag.indexOf('.');
  const methods = (
    HOST_SCOPES as Record<string, Record<string, Capabilities.AuthScope>>
  )[tag.slice(0, dot)];
  const method = tag.slice(dot + 1);
  return methods && Object.hasOwn(methods, method)
    ? methods[method]
    : undefined;
};

/** Whether `tag` has a scope of its own here; the rest are `local` by default. */
export const isClassified = (tag: string) =>
  tag === 'device.command' ||
  Object.hasOwn(CORE_SCOPES, tag) ||
  hostScope(tag) !== undefined;

/**
 * The scope an RPC needs: a device command's by its type (`commandScope`), any other tag's from the tables above, and
 * `local` for a tag in neither, so nothing new opens to a device by default.
 */
export const scopeOf = (
  tag: string,
  payload?: unknown,
): Capabilities.AuthScope =>
  tag === 'device.command'
    ? Relay.commandScope(
        (payload as { command?: unknown } | undefined)?.command,
      )
    : Object.hasOwn(CORE_SCOPES, tag)
      ? CORE_SCOPES[tag as CoreTag]
      : (hostScope(tag) ?? 'local');
