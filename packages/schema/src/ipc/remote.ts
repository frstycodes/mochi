import { Schema } from 'effect';
import { AgentModel } from '../agent.ts';
import { ArrayOf, event, Int, invoke, Str } from '../checks.ts';
import { Access, AgentImage, Provider } from '../model.ts';
import { ChangeTarget, DiffScope, GitDiff } from './git.ts';
import { Project } from './projects.ts';

const opt = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const T = Schema.Tuple;
const Void = Schema.Void;

export const Scope = Schema.Literals(['read', 'operate', 'manage', 'code', 'terminal']);
export type Scope = typeof Scope.Type;

export const DeviceKind = Schema.Literals(['mac', 'windows', 'linux', 'phone']);
export type DeviceKind = typeof DeviceKind.Type;

export const RemoteSettings = Schema.Struct({ isEnabled: B, allowsNetwork: B, machineName: S, reachesAnywhere: B, keepsAwake: B });
export type RemoteSettings = typeof RemoteSettings.Type;

export const RelayState = Schema.Union([
  Schema.Struct({ status: Schema.Literal('off') }),
  Schema.Struct({ status: Schema.Literal('connecting') }),
  Schema.Struct({ status: Schema.Literal('connected') }),
  Schema.Struct({ status: Schema.Literal('error'), error: S }),
]);
export type RelayState = typeof RelayState.Type;

const MachineStatus = Schema.Literals(['connecting', 'online', 'offline', 'refused']);

export const FollowedMachine = Schema.Struct({
  id: S,
  name: S,
  kind: opt(DeviceKind),
  status: MachineStatus,
  route: opt(Schema.Literals(['lan', 'relay'])),
  scopes: Schema.Array(Scope),
  error: opt(S),
  lastSeenAt: opt(N),
});
export type FollowedMachine = typeof FollowedMachine.Type;

export const MemberInfo = Schema.Struct({ id: S, name: S, kind: opt(DeviceKind), scopes: Schema.Array(Scope), addedAt: N, machineStatus: opt(MachineStatus) });
export type MemberInfo = typeof MemberInfo.Type;

export const OtherMachine = Schema.Struct({ id: S, name: S, isOnline: B, pairingCode: S });
export type OtherMachine = typeof OtherMachine.Type;

export const StreamFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal('snapshot'), epoch: S, seq: N, saved: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal('action'), epoch: S, seq: N, action: Schema.Unknown }),
]);
export type StreamFrame = typeof StreamFrame.Type;

export const ApprovalRequest = Schema.Struct({ id: S, name: S, pairingCode: S, expiresAt: N });
export type ApprovalRequest = typeof ApprovalRequest.Type;

export const ConnectedDevice = Schema.Struct({ id: S, name: S, kind: opt(DeviceKind), scopes: Schema.Array(Scope), connectedAt: N });
export type ConnectedDevice = typeof ConnectedDevice.Type;

export const RemoteStatus = Schema.Struct({
  settings: RemoteSettings,
  hostName: S,
  addresses: Schema.Array(S),
  devices: Schema.Array(ConnectedDevice),
  members: Schema.Array(MemberInfo),
  isRemoved: B,
  relay: RelayState,
  isOnBattery: B,
  error: opt(S),
});
export type RemoteStatus = typeof RemoteStatus.Type;

// A device's command is untrusted (`parseRemoteCommand` in `electron/remote/protocol.ts`): every field is bounded.
const MAX_ID = 128;
const MAX_TEXT = 256 * 1024;
const MAX_TITLE = 256;
const MAX_PATH = 4096;
const Ref = Str(MAX_ID);
const Text = Str(MAX_TEXT);
const nonBlank = <S extends Schema.Top & { readonly Type: string }>(schema: S) => schema.check(Schema.makeFilter((text: string) => !!text.trim() || 'must not be blank'));
const Index = Int.check(Schema.isGreaterThanOrEqualTo(0));
const Size = Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));
/** Inside the thread's folder: posix separators, nothing absolute, no `..` (`isRelativePath`). */
const RelativePath = nonBlank(Str(MAX_PATH)).check(
  Schema.makeFilter((path: string) => (!path.includes('\\') && !path.includes('\0') && !/^([a-zA-Z]:|\/)/.test(path) && !path.split('/').includes('..')) || 'must be a path relative to the thread’s folder'),
);
export const ThreadPoint = Schema.Union([Schema.Struct({ kind: Schema.Literal('message'), index: Index }), Schema.Struct({ kind: Schema.Literal('checkpoint'), n: Index })]);
export type ThreadPoint = typeof ThreadPoint.Type;

const Answers = ArrayOf(ArrayOf(Str(16 * 1024), 64), 64);

/** A device's controls: the catalog ids main checks, never the legacy access names a saved thread may hold. */
const Controls = Schema.Struct({ model: Ref, effort: Ref, speed: Ref, access: Access });
/**
 * At most what the composer attaches: 5 MB images as base64 with a small thumbnail. GAP: today's parser drops `original` (a
 * file path on this computer); here a device that sends one is refused.
 */
const DeviceImage = Schema.Struct({
  ...AgentImage.fields,
  data: Str(Math.ceil((5_000_000 * 4) / 3)),
  thumb: Str(512 * 1024),
  original: opt(S.check(Schema.makeFilter(() => 'a device can’t name a file on this computer'))),
});

/** GAP: main also requires `normalizeOrigin(url)` (`isCloneUrl`, `src/git/origin.ts`); only its cheap half is here. */
const CloneUrl = Str(MAX_PATH).check(Schema.makeFilter((url: string) => (!/[\s\0]/.test(url) && !url.startsWith('-')) || 'must be a git URL'));
const DeviceCloneSource = Schema.Union([Schema.Struct({ url: CloneUrl }), Schema.Struct({ github: Str(MAX_TITLE).check(Schema.isPattern(/^[\w.-]+\/(?!\.\.?$)[\w.-]+$/)) })]);

const command = <const K extends string, F extends Schema.Struct.Fields>(type: K, fields: F) => Schema.Struct({ type: Schema.Literal(type), ...fields });

/** What a device asks this computer to do (`src/host/types/remote.ts`), with the relay's limits. The relay's frames carry it. */
export const RemoteCommand = Schema.Union([
  command('catalog', {}),
  command('settings', {}),
  command('projects', {}),
  command('send', { threadId: Ref, text: nonBlank(Text) }),
  command('resolve', { queueId: Ref, answers: opt(Answers) }),
  command('interrupt', { threadId: Ref }),
  command('fork', { threadId: Ref, point: ThreadPoint }),
  command('handoff', { threadId: Ref, to: Provider }),
  command('rewind', { threadId: Ref, point: ThreadPoint, mode: Schema.Literals(['chat', 'files']) }),
  command('side-chat', { threadId: Ref, text: nonBlank(Text) }),
  command('seen', { threadId: opt(Ref), queueIds: opt(ArrayOf(nonBlank(Ref), 500)) }).check(Schema.makeFilter((c) => c.threadId !== undefined || c.queueIds !== undefined || 'seen needs threadId, queueIds or both')),
  command('create', { title: nonBlank(Text), provider: Provider, project: Schema.NullOr(Ref), controls: opt(Controls), images: opt(ArrayOf(DeviceImage, 8)) }),
  command('rename', { threadId: Ref, title: nonBlank(Str(MAX_TITLE)) }),
  command('edit-goal', { threadId: Ref, goal: nonBlank(Text) }),
  command('pin', { threadId: Ref, isPinned: B, order: opt(Schema.Finite) }),
  command('settle', { threadId: Ref, isSettled: B }),
  command('schedule', { threadId: Ref, action: Schema.Literals(['pause', 'resume', 'run', 'remove']) }),
  command('commit', { threadId: Ref, message: nonBlank(Text) }),
  command('push', { threadId: Ref }),
  command('open-pr', { threadId: Ref, title: nonBlank(Str(MAX_TITLE)), body: Text }),
  command('delete', { threadId: Ref }),
  command('add-project', { name: Str(MAX_TITLE).check(Schema.isPattern(/^(?!\.\.?$)[\w.-]+$/)), publish: opt(Schema.Literals(['private', 'public'])) }),
  command('clone-project', { source: DeviceCloneSource }),
  command('setting', { key: nonBlank(Ref), value: Text }),
  command('diff', { threadId: Ref, scope: DiffScope }),
  command('checkpoint-diff', { threadId: Ref, n: Index }),
  command('change', { threadId: Ref, action: Schema.Literals(['stage', 'unstage', 'revert']), target: Schema.Struct({ ...ChangeTarget.fields, path: RelativePath, patch: opt(Str(512 * 1024)) }) }),
  command('comment', { threadId: Ref, path: RelativePath, side: Schema.Literals(['additions', 'deletions']), line: Index, text: nonBlank(Text) }),
  command('files', { threadId: Ref }),
  command('read-file', { threadId: Ref, path: RelativePath }),
  command('terminal-open', { threadId: Ref, cols: Size, rows: Size }),
  command('terminal-write', { threadId: Ref, terminalId: Ref, data: Text.check(Schema.isNonEmpty()) }),
  command('terminal-resize', { threadId: Ref, terminalId: Ref, cols: Size, rows: Size }),
  command('terminal-read', { threadId: Ref, terminalId: Ref, after: Index }),
  command('terminal-close', { threadId: Ref, terminalId: Ref }),
]);
export type RemoteCommand = typeof RemoteCommand.Type;

export const CatalogProject = Schema.Struct({ ref: S, name: S });
export type CatalogProject = typeof CatalogProject.Type;

export const MachineCatalog = Schema.Struct({
  projects: Schema.Array(CatalogProject),
  models: Schema.Struct({ claude: opt(Schema.Array(AgentModel)), codex: opt(Schema.Array(AgentModel)) }),
  defaults: Schema.Struct({ claude: S, codex: S }),
});
export type MachineCatalog = typeof MachineCatalog.Type;

export const TerminalOutput = Schema.Struct({ data: S, next: N, exitCode: opt(N) });
export type TerminalOutput = typeof TerminalOutput.Type;

/** `CommandData[keyof CommandData]`: what a command answers with, by type. */
export const CommandData = Schema.Union([
  MachineCatalog,
  Schema.Record(S, S),
  Schema.Array(Project),
  CatalogProject,
  GitDiff,
  Schema.Struct({ paths: Schema.Array(S), isTruncated: B }),
  Schema.Struct({ text: S }),
  Schema.Struct({ terminalId: S }),
  TerminalOutput,
]);

/** `data` is a pane's payload; its size is capped when it's sent (`resultFrame`), not here. */
export const CommandResult = Schema.Union([Schema.Struct({ isOk: Schema.Literal(true), detail: opt(Str()), data: opt(CommandData) }), Schema.Struct({ isOk: Schema.Literal(false), error: Str() })]);
export type CommandResult = typeof CommandResult.Type;

export const RemoteCommandRequest = Schema.Struct({ id: S, deviceName: S, command: RemoteCommand });
export type RemoteCommandRequest = typeof RemoteCommandRequest.Type;

const MAX_ACTION_CHARS = 64 * 1024 * 1024;
const MachineId = Str(64);
const Epoch = Str(64);
const Seq = Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));

export const remoteRpc = {
  status: invoke(T([]), RemoteStatus),
  set: invoke(T([Schema.Struct({ isEnabled: opt(B), allowsNetwork: opt(B), machineName: opt(Str(64)), reachesAnywhere: opt(B), keepsAwake: opt(B) })]), RemoteStatus),
  onStatus: event(RemoteStatus),
  push: invoke(T([Epoch, Seq.check(Schema.isGreaterThanOrEqualTo(1)), Str(MAX_ACTION_CHARS)]), Void),
  snapshot: invoke(T([Str(64), Epoch, Seq, Str(MAX_ACTION_CHARS)]), Void),
  onSnapshotRequest: event(S),
  onCommand: event(RemoteCommandRequest),
  commandResult: invoke(T([Str(128), CommandResult]), Void),
  removeMember: invoke(T([MachineId]), RemoteStatus),
  setDeviceScopes: invoke(T([MachineId, Schema.Array(Scope)]), RemoteStatus),
  onApproval: event(ApprovalRequest),
  answerApproval: invoke(T([MachineId, B]), Void),
  otherMachines: invoke(T([]), Schema.Array(OtherMachine)),
  join: invoke(T([MachineId]), Void),
  machines: invoke(T([]), Schema.Array(FollowedMachine)),
  onMachines: event(Schema.Array(FollowedMachine)),
  follow: invoke(T([]), Void),
  onMachineFrame: event(Schema.Struct({ machineId: S, frame: StreamFrame })),
  cacheMachine: invoke(T([MachineId, Str(MAX_ACTION_CHARS)]), Void),
  cachedMachines: invoke(T([]), Schema.Array(Schema.Struct({ machineId: S, saved: S }))),
  command: invoke(T([MachineId, RemoteCommand]), CommandResult),
};
