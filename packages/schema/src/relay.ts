import { Schema, SchemaTransformation } from 'effect';
import { AgentModel } from './agent.ts';
import { Int, Str } from './checks.ts';
import { DiffScope, GitDiff } from './ipc/git.ts';
import { Project } from './ipc/projects.ts';
import { Access, AgentImage, Provider } from './model.ts';

// Frames carry no `v`: they are a live wire protocol, never persisted or replayed as is, versioned as a whole by
// `hello.version` (a device on another protocol is refused at the handshake). What they carry that is persisted is versioned
// by its own schema: a snapshot's `saved` (`persist.ts`), an action's agent event (`agent.ts`).

const opt = Schema.optional;
const S = Schema.String;
const B = Schema.Boolean;

/** `PROTOCOL_VERSION` in `electron/remote/protocol.ts`: bumped on any frame change. */
export const PROTOCOL_VERSION = 3;

const MAX_ID = 128;
const MAX_TEXT = 256 * 1024;
const MAX_TITLE = 256;
const MAX_PATH = 4096;
const MAX_SEEN = 500;
const MAX_PATCH = 512 * 1024;
const MAX_THUMB = 512 * 1024;
// `MAX_IMAGE_BYTES` (src/chat/images.ts) as base64.
const MAX_IMAGE_CHARS = Math.ceil((5_000_000 * 4) / 3);
const MAX_IMAGES = 8;

export const Scope = Schema.Literals(['read', 'operate', 'manage', 'code', 'terminal']);
export type Scope = typeof Scope.Type;

export const DeviceKind = Schema.Literals(['mac', 'windows', 'linux', 'phone']);
export type DeviceKind = typeof DeviceKind.Type;

const notBlank = Schema.makeFilter((s: string) => !!s.trim() || 'must not be blank');
/** `isText`: up to `max` chars with something besides whitespace. */
const Text = (max: number) => Str(max).check(notBlank);
/** `isText`, then trimmed: titles, goals and names a device sends. */
const TrimmedText = (max: number) => Text(max).pipe(Schema.decodeTo(S, SchemaTransformation.trim()));
const Id = Str(MAX_ID);
const NonEmptyId = Id.check(Schema.isMinLength(1));
const Index = Int.check(Schema.isGreaterThanOrEqualTo(0));
const Size = Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));

/**
 * A path inside the thread's folder as this computer lists it: posix separators, nothing absolute, no `..` (`isRelativePath`).
 */
export const RelativePath = Text(MAX_PATH).check(
  Schema.makeFilter((p: string) => (!p.includes('\\') && !p.includes('\0') && !/^([a-zA-Z]:|\/)/.test(p) && !p.split('/').includes('..')) || 'must be a path relative to the thread’s folder'),
);

export const ThreadPoint = Schema.Union([Schema.Struct({ kind: Schema.Literal('message'), index: Index }), Schema.Struct({ kind: Schema.Literal('checkpoint'), n: Index })]);
export type ThreadPoint = typeof ThreadPoint.Type;

const RemoteControls = Schema.Struct({ model: Id, effort: Id, speed: Id, access: Access });

/** `parseImages`: what the composer attaches. A device never names `original`, a path on this computer: it is dropped. */
const RemoteImage = Schema.Struct({ mediaType: AgentImage.fields.mediaType, data: Str(MAX_IMAGE_CHARS), thumb: Str(MAX_THUMB) });

const PROJECT_NAME = /^(?!\.\.?$)[\w.-]+$/;
const OWNER_REPO = /^[\w.-]+\/(?!\.\.?$)[\w.-]+$/;

/** A device names what to clone, never where; exactly one of `url` (a network git remote) or `github` (`owner/repo`). */
const RemoteCloneSource = Schema.Record(S, Schema.Unknown)
  .check(Schema.makeFilter((s) => !('url' in s && 'github' in s) || 'clone source takes url or github, not both'))
  .pipe(
    Schema.decodeTo(
      Schema.Union([
        Schema.Struct({ url: Str(MAX_PATH).check(Schema.makeFilter((url: string) => isCloneUrl(url) || 'must be a network git remote')) }),
        Schema.Struct({ github: Str(MAX_TITLE).check(Schema.isPattern(OWNER_REPO)) }),
      ]),
    ),
  );

const ChangeTarget = Schema.Struct({ path: RelativePath, staged: B, untracked: opt(B), patch: opt(Str(MAX_PATCH)) });

const Answers = Schema.Array(Schema.Array(Str(16 * 1024)).check(Schema.isMaxLength(64))).check(Schema.isMaxLength(64));

const command = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) => Schema.Struct({ type: Schema.Literal(type), ...fields });

/**
 * What a device can ask this computer to do: `parseRemoteCommand` (`electron/remote/protocol.ts`) as a schema, limit for
 * limit. Fields a command doesn't take are dropped; titles, goals and names come back trimmed.
 */
export const RemoteCommand = Schema.Union([
  command('catalog', {}),
  command('settings', {}),
  command('projects', {}),
  command('send', { threadId: Id, text: Text(MAX_TEXT) }),
  command('resolve', { queueId: Id, answers: opt(Answers) }),
  command('interrupt', { threadId: Id }),
  command('fork', { threadId: Id, point: ThreadPoint }),
  command('handoff', { threadId: Id, to: Provider }),
  command('rewind', { threadId: Id, point: ThreadPoint, mode: Schema.Literals(['chat', 'files']) }),
  command('side-chat', { threadId: Id, text: Text(MAX_TEXT) }),
  command('seen', { threadId: opt(Id), queueIds: opt(Schema.Array(NonEmptyId).check(Schema.isMaxLength(MAX_SEEN))) }).check(
    Schema.makeFilter((c) => c.threadId !== undefined || c.queueIds !== undefined || `seen needs threadId, queueIds (up to ${MAX_SEEN} ids) or both`),
  ),
  command('create', { title: TrimmedText(MAX_TEXT), provider: Provider, project: Schema.NullOr(Id), controls: opt(RemoteControls), images: opt(Schema.Array(RemoteImage).check(Schema.isMaxLength(MAX_IMAGES))) }),
  command('rename', { threadId: Id, title: TrimmedText(MAX_TITLE) }),
  command('edit-goal', { threadId: Id, goal: TrimmedText(MAX_TEXT) }),
  command('pin', { threadId: Id, isPinned: B, order: opt(Schema.Finite) }),
  command('settle', { threadId: Id, isSettled: B }),
  command('schedule', { threadId: Id, action: Schema.Literals(['pause', 'resume', 'run', 'remove']) }),
  command('commit', { threadId: Id, message: Text(MAX_TEXT) }),
  command('push', { threadId: Id }),
  command('open-pr', { threadId: Id, title: TrimmedText(MAX_TITLE), body: Str(MAX_TEXT) }),
  command('delete', { threadId: Id }),
  command('add-project', { name: Str(MAX_TITLE).check(Schema.isPattern(PROJECT_NAME)), publish: opt(Schema.Literals(['private', 'public'])) }),
  command('clone-project', { source: RemoteCloneSource }),
  command('setting', { key: Text(MAX_ID), value: Str(MAX_TEXT) }),
  command('diff', { threadId: Id, scope: DiffScope }),
  command('checkpoint-diff', { threadId: Id, n: Index }),
  command('change', { threadId: Id, action: Schema.Literals(['stage', 'unstage', 'revert']), target: ChangeTarget }),
  command('comment', { threadId: Id, path: RelativePath, side: Schema.Literals(['additions', 'deletions']), line: Index, text: Text(MAX_TEXT) }),
  command('files', { threadId: Id }),
  command('read-file', { threadId: Id, path: RelativePath }),
  command('terminal-open', { threadId: Id, cols: Size, rows: Size }),
  command('terminal-write', { threadId: Id, terminalId: Id, data: Str(MAX_TEXT).check(Schema.isMinLength(1)) }),
  command('terminal-resize', { threadId: Id, terminalId: Id, cols: Size, rows: Size }),
  command('terminal-read', { threadId: Id, terminalId: Id, after: Index }),
  command('terminal-close', { threadId: Id, terminalId: Id }),
]);
export type RemoteCommand = typeof RemoteCommand.Type;

export const CatalogProject = Schema.Struct({ ref: S, name: S });

export const MachineCatalog = Schema.Struct({
  projects: Schema.Array(CatalogProject),
  models: Schema.Struct({ claude: opt(Schema.Array(AgentModel)), codex: opt(Schema.Array(AgentModel)) }),
  defaults: Schema.Struct({ claude: S, codex: S }),
});

export const TerminalOutput = Schema.Struct({ data: S, next: Schema.Number, exitCode: opt(Schema.Number) });

/**
 * `CommandData[keyof CommandData]`. Nothing on the wire says which command a result answers, so the all-string shapes
 * (`settings`, a catalog project, `read-file`, `terminal-open`) decode through the string record, which keeps every key.
 */
const CommandData = Schema.Union([
  MachineCatalog,
  GitDiff,
  TerminalOutput,
  Schema.Struct({ paths: Schema.Array(S), isTruncated: B }),
  Schema.Array(Project),
  Schema.Record(S, S),
  CatalogProject,
  Schema.Struct({ text: S }),
  Schema.Struct({ terminalId: S }),
]);

const okFields = { isOk: Schema.Literal(true), detail: opt(S), data: opt(CommandData) };
const failedFields = { isOk: Schema.Literal(false), error: S };

export const CommandResult = Schema.Union([Schema.Struct(okFields), Schema.Struct(failedFields)]);
export type CommandResult = typeof CommandResult.Type;

export const RemoteCommandRequest = Schema.Struct({ id: S, deviceName: S, command: RemoteCommand });
export type RemoteCommandRequest = typeof RemoteCommandRequest.Type;

/** The first frame once paired. Off-protocol devices are refused with the reason `parseHello` gives. */
export const HelloFrame = Schema.Struct({
  type: Schema.Literal('hello'),
  version: Schema.Number.check(Schema.makeFilter((v: number) => v === PROTOCOL_VERSION || `This machine speaks protocol ${PROTOCOL_VERSION}; update Mochi on both sides`)),
  resume: opt(Schema.Struct({ epoch: NonEmptyId, seq: Index })),
  members: opt(Schema.Unknown),
});
export type HelloFrame = typeof HelloFrame.Type;

export const CommandFrame = Schema.Struct({ type: Schema.Literal('command'), id: NonEmptyId, command: RemoteCommand });
export type CommandFrame = typeof CommandFrame.Type;

/**
 * A machine's stream: a fresh base, then each store action numbered within the base's epoch. `saved` and `action` stay
 * `unknown` here; pass the snapshot's schema (`persist.ts`) to `streamFrame` to decode it whole.
 */
export const streamFrame = <Saved extends Schema.Top>(saved: Saved) =>
  Schema.Union([
    Schema.Struct({ type: Schema.Literal('snapshot'), epoch: S, seq: Schema.Number, saved }),
    Schema.Struct({ type: Schema.Literal('action'), epoch: S, seq: Schema.Number, action: Schema.Unknown }),
  ]);

export const StreamFrame = streamFrame(Schema.Unknown);
export type StreamFrame = typeof StreamFrame.Type;

/** A machine's frame on the device. The machine proved its key at pairing; this checks the shape. */
export const ServerFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal('welcome'), version: Schema.Number, deviceId: S, machineName: S, machineKind: DeviceKind, scopes: Schema.Array(Scope), addresses: Schema.Array(S), members: opt(Schema.Unknown) }),
  Schema.Struct({ type: Schema.Literal('refused'), reason: S }),
  Schema.Struct({ type: Schema.Literal('members'), members: Schema.Unknown }),
  ...StreamFrame.members,
  Schema.Struct({ type: Schema.Literal('result'), id: S, ...okFields }),
  Schema.Struct({ type: Schema.Literal('result'), id: S, ...failedFields }),
]);
export type ServerFrame = typeof ServerFrame.Type;

// Mirrors `isCloneUrl` / `normalizeOrigin` in src/git/origin.ts, which this package can't import.
const SCHEMES = ['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'];
const HOST = /^[\w.-]+$/;

function isCloneUrl(url: string) {
  return !/[\s\0]/.test(url) && !url.startsWith('-') && isNetworkRemote(url.trim());
}

function isNetworkRemote(url: string) {
  const remote = splitRemote(url);
  const path = remote?.path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return !!path && !path.split('/').some((part) => !part || part === '.' || part === '..');
}

function splitRemote(url: string) {
  if (url.includes('://')) {
    try {
      const parsed = new URL(url);
      if (!SCHEMES.includes(parsed.protocol) || !HOST.test(parsed.hostname)) return null;
      return { path: decodeURIComponent(parsed.pathname) };
    } catch {
      return null;
    }
  }
  const scp = url.match(/^(?:[^@/\\]+@)?([^:/\\]{2,}):(?![/:])([^\\]+)$/);
  return scp && HOST.test(scp[1]) ? { path: scp[2] } : null;
}
