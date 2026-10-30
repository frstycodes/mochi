import { Schema, SchemaTransformation } from 'effect';
import { AgentModel } from './agent.ts';
import { BackendInfo } from './backend.ts';
import { Int, Str } from './checks.ts';
import {
  DiffFile,
  DiffScope,
  GitDiff,
  MergeMethod,
  MergeMode,
  PrInfo,
  PrReview,
  ReviewVerdict,
  RewindPreview,
  SyncResult,
} from './ipc/git.ts';
import { PortsListing } from './ipc/ports.ts';
import { MissedRuns, Trigger, TriggerWhen } from './ipc/schedule.ts';
import { Project } from './ipc/projects.ts';
import { Access, AgentCommand, AgentImage, Provider } from './model.ts';
import { Quote } from './persist.ts';

// Frames carry no `v`: they are a live wire protocol, never persisted or replayed as is, versioned as a whole by
// `hello.version` (a device on another protocol is refused at the handshake). What they carry that is persisted is versioned
// by its own schema: a thread file (`persist.ts`).

const opt = Schema.optional;
const S = Schema.String;
const B = Schema.Boolean;

/** Bumped on any link frame change; a device on another version is refused rather than misread. */
export const PROTOCOL_VERSION = 8;

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
const MAX_MENTIONS = 64;
const MAX_QUEUED = 100;

export const Scope = Schema.Literals([
  'read',
  'operate',
  'manage',
  'code',
  'terminal',
]);
export type Scope = typeof Scope.Type;

export const DeviceKind = Schema.Literals(['mac', 'windows', 'linux', 'phone']);
export type DeviceKind = typeof DeviceKind.Type;

const notBlank = Schema.makeFilter(
  (s: string) => !!s.trim() || 'must not be blank',
);
/** `isText`: up to `max` chars with something besides whitespace. */
const Text = (max: number) => Str(max).check(notBlank);
/** `isText`, then trimmed: titles and names a device sends. */
const TrimmedText = (max: number) =>
  Text(max).pipe(Schema.decodeTo(S, SchemaTransformation.trim()));
const Id = Str(MAX_ID);
const NonEmptyId = Id.check(Schema.isMinLength(1));
const Index = Int.check(Schema.isGreaterThanOrEqualTo(0));
const Size = Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));

/**
 * A path inside the thread's folder as this computer lists it: posix separators, nothing absolute, no `..` (`isRelativePath`).
 */
export const RelativePath = Text(MAX_PATH).check(
  Schema.makeFilter(
    (p: string) =>
      (!p.includes('\\') &&
        !p.includes('\0') &&
        !/^([a-zA-Z]:|\/)/.test(p) &&
        !p.split('/').includes('..')) ||
      'must be a path relative to the thread’s folder',
  ),
);

export const ThreadPoint = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('message'), index: Index }),
  Schema.Struct({ kind: Schema.Literal('checkpoint'), n: Index }),
]);
export type ThreadPoint = typeof ThreadPoint.Type;

const RemoteControls = Schema.Struct({
  model: Id,
  effort: Id,
  speed: Id,
  access: Access,
});

/** `parseImages`: what the composer attaches. A device never names `original`, a path on this computer: it is dropped. */
const RemoteImage = Schema.Struct({
  mediaType: AgentImage.fields.mediaType,
  data: Str(MAX_IMAGE_CHARS),
  thumb: Str(MAX_THUMB),
});

const Images = Schema.Array(RemoteImage).check(Schema.isMaxLength(MAX_IMAGES));

/** `Mention`: what the composer references. A file is one the thread's `files` listed; a window comes as its screenshot. */
const RemoteMention = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('thread'),
    id: Id,
    title: Str(MAX_TITLE),
  }),
  Schema.Struct({
    kind: Schema.Literal('window'),
    id: Id,
    title: Str(MAX_TITLE),
    icon: opt(Str(MAX_THUMB)),
    image: Schema.Struct({
      mediaType: AgentImage.fields.mediaType,
      data: Str(MAX_IMAGE_CHARS),
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal('skill'),
    id: Id,
    title: Str(MAX_TITLE),
    description: Str(MAX_TEXT),
  }),
  Schema.Struct({
    kind: Schema.Literal('mcp'),
    id: Id,
    title: Str(MAX_TITLE),
    toolCount: opt(Index),
  }),
  Schema.Struct({
    kind: Schema.Literal('plugin'),
    id: Id,
    title: Str(MAX_TITLE),
  }),
  Schema.Struct({
    kind: Schema.Literal('file'),
    id: Str(MAX_PATH),
    title: Str(MAX_PATH),
    path: RelativePath,
    isDir: B,
  }),
]);

/** `QueuedMessage` as typed, without its id: the machine resolves its references as its composer would (`sendAction`). */
const messageFields = {
  draft: Str(MAX_TEXT),
  images: opt(Images),
  mentions: opt(
    Schema.Array(RemoteMention).check(Schema.isMaxLength(MAX_MENTIONS)),
  ),
  isCommand: opt(B),
  typedSkills: opt(Schema.Array(Id).check(Schema.isMaxLength(MAX_MENTIONS))),
};
const hasContent = Schema.makeFilter(
  (m: {
    draft: string;
    images?: readonly unknown[];
    mentions?: readonly unknown[];
  }) =>
    !!m.draft.trim() ||
    !!m.images?.length ||
    !!m.mentions?.length ||
    'a message needs text, an image or a reference',
);
const RemoteMessage = Schema.Struct(messageFields).check(hasContent);

const action = <const T extends string, F extends Schema.Struct.Fields>(
  type: T,
  fields: F,
) => Schema.Struct({ type: Schema.Literal(type), ...fields });

/**
 * The store actions on one thread a device may ask for (`thread-action`), each as the thread's own UI dispatches it, less the
 * thread id and whatever the machine stamps itself (times, ids). Each needs its `THREAD_ACTION_SCOPES` scope.
 */
export const ThreadAction = Schema.Union([
  action('controls', { controls: RemoteControls }),
  action('provider-switch', { to: Provider, model: opt(Id) }),
  action('compact', { focus: Str(MAX_TEXT), queuedId: opt(Id) }),
  action('queued-add', { message: RemoteMessage }),
  action('queued-remove', { id: Id }),
  action('queued-order', {
    ids: Schema.Array(Id).check(Schema.isMaxLength(MAX_QUEUED)),
  }),
  action('queued-resume', {}),
  action('resume', {}),
  action('limit-auto-resume', { isOn: B }),
  action('grant-answer', {
    grantId: Id,
    answer: Schema.Literals(['allow', 'deny', 'revoke']),
    models: opt(Schema.Array(Id).check(Schema.isMaxLength(MAX_MENTIONS))),
  }),
  action('proposal-answer', {
    proposalId: Id,
    state: Schema.Literals(['dismissed', 'here']),
  }),
  action('proposal-start', { proposalId: Id }),
  action('autofix-set', { pr: Index, isOn: B }),
  action('auto-archive-set', { pr: Index, isOn: B }),
]);
export type ThreadAction = typeof ThreadAction.Type;

/** `operate` steers the agent and answers its cards; `manage` changes the thread itself (its PR's watchers, new threads). */
export const THREAD_ACTION_SCOPES = {
  controls: 'operate',
  'provider-switch': 'operate',
  compact: 'operate',
  'queued-add': 'operate',
  'queued-remove': 'operate',
  'queued-order': 'operate',
  'queued-resume': 'operate',
  resume: 'operate',
  'limit-auto-resume': 'operate',
  'grant-answer': 'operate',
  'proposal-answer': 'operate',
  'proposal-start': 'manage',
  'autofix-set': 'manage',
  'auto-archive-set': 'manage',
} as const satisfies Record<ThreadAction['type'], Scope>;

const PROJECT_NAME = /^(?!\.\.?$)[\w.-]+$/;
const OWNER_REPO = /^[\w.-]+\/(?!\.\.?$)[\w.-]+$/;

/** A device names what to clone, never where; exactly one of `url` (a network git remote) or `github` (`owner/repo`). */
const RemoteCloneSource = Schema.Record(S, Schema.Unknown)
  .check(
    Schema.makeFilter(
      (s) =>
        !('url' in s && 'github' in s) ||
        'clone source takes url or github, not both',
    ),
  )
  .pipe(
    Schema.decodeTo(
      Schema.Union([
        Schema.Struct({
          url: Str(MAX_PATH).check(
            Schema.makeFilter(
              (url: string) =>
                isCloneUrl(url) || 'must be a network git remote',
            ),
          ),
        }),
        Schema.Struct({
          github: Str(MAX_TITLE).check(Schema.isPattern(OWNER_REPO)),
        }),
      ]),
    ),
  );

const ChangeTarget = Schema.Struct({
  path: RelativePath,
  staged: B,
  untracked: opt(B),
  patch: opt(Str(MAX_PATCH)),
});

const Answers = Schema.Array(
  Schema.Array(Str(16 * 1024)).check(Schema.isMaxLength(64)),
).check(Schema.isMaxLength(64));

const command = <const T extends string, F extends Schema.Struct.Fields>(
  type: T,
  fields: F,
) => Schema.Struct({ type: Schema.Literal(type), ...fields });

const MAX_PATTERN = 1024;
const CommitRef = Str(64).check(Schema.isPattern(/^[0-9a-f]{4,64}$/));
/** A path on this computer that the thread itself names (an image it attached, a task's output file): checked against the thread. */
const ThreadFilePath = Text(MAX_PATH).check(
  Schema.makeFilter((p: string) => !p.includes('\0') || 'must not hold NUL'),
);

/** The side pane's reads and writes on another computer's thread (phase 6): saving and searching files, turn diffs, images, task output. */
const PANE_COMMANDS = [
  command('write-file', {
    threadId: Id,
    path: RelativePath,
    text: Str(MAX_TEXT),
    baseMtimeMs: Schema.Finite,
    force: opt(B),
  }),
  command('search', {
    threadId: Id,
    pattern: Text(MAX_PATTERN),
    isCaseSensitive: B,
    isRegex: B,
    isWholeWord: B,
  }),
  command('turn-diff', { threadId: Id, from: CommitRef, to: opt(CommitRef) }),
  command('read-image', { threadId: Id, path: ThreadFilePath }),
  command('read-task-output', { threadId: Id, path: ThreadFilePath }),
] as const;

const SearchLine = Schema.Struct({
  line: Schema.Number,
  text: S,
  isCut: B,
  ranges: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
  column: Schema.Tuple([Schema.Number, Schema.Number]),
});

/** What the pane commands answer. Structs keep only their own keys, so a shape that extends another comes first. */
const PaneCommandData = [
  Schema.Struct({
    status: Schema.Literal('conflict'),
    text: S,
    mtimeMs: Schema.Number,
  }),
  Schema.Struct({ status: Schema.Literal('saved'), mtimeMs: Schema.Number }),
  Schema.Struct({ text: S, mtimeMs: Schema.Number }),
  Schema.Struct({
    hits: Schema.Array(
      Schema.Struct({ path: S, lines: Schema.Array(SearchLine) }),
    ),
    isTruncated: B,
  }),
  Schema.Struct({ turnFiles: Schema.Array(DiffFile) }),
  Schema.Struct({ mediaType: S, base64: S }),
] as const;

// The thread's remaining actions, run on the computer that owns it (PR tab, worktree, schedule, project, ports, rewind).

const PrNumber = Int.check(Schema.isBetween({ minimum: 1, maximum: 1e9 }));
const MAX_PR_BODY = 64 * 1024;

/** The PR tab's writes, as the thread's profile's GitHub login there. A review thread is one of that PR's own. */
const PrAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('comment'), body: Text(MAX_PR_BODY) }),
  Schema.Struct({
    kind: Schema.Literal('review'),
    verdict: ReviewVerdict,
    body: Str(MAX_PR_BODY),
  }),
  Schema.Struct({
    kind: Schema.Literal('reply'),
    reviewThreadId: NonEmptyId,
    body: Text(MAX_PR_BODY),
  }),
  Schema.Struct({
    kind: Schema.Literal('resolve'),
    reviewThreadId: NonEmptyId,
    isResolved: B,
  }),
  Schema.Struct({
    kind: Schema.Literal('merge'),
    method: MergeMethod,
    mode: MergeMode,
  }),
]);

const THREAD_OP_COMMANDS = [
  command('pr-status', { threadId: Id }),
  command('pr-review', { threadId: Id, number: PrNumber }),
  command('pr', { threadId: Id, number: PrNumber, action: PrAction }),
  command('sync', { threadId: Id }),
  command('disk-usage', { threadId: Id }),
  command('schedules', {}),
  command('schedule-set', {
    threadId: Id,
    name: Str(200),
    prompt: Str(100_000),
    when: TriggerWhen,
    missed: MissedRuns,
  }),
  command('attach-project', { threadId: Id, project: NonEmptyId }),
  command('ports', { threadId: Id }),
  command('port-kill', {
    threadId: Id,
    pid: Int.check(Schema.isGreaterThan(0)),
  }),
  command('rewind-preview', { threadId: Id, n: Index }),
] as const;

const THREAD_OP_SCOPES = {
  'pr-status': 'read',
  'pr-review': 'code',
  pr: 'manage',
  sync: 'manage',
  'disk-usage': 'read',
  schedules: 'read',
  'schedule-set': 'manage',
  'attach-project': 'manage',
  ports: 'read',
  'port-kill': 'manage',
  'rewind-preview': 'code',
} as const satisfies Record<
  (typeof THREAD_OP_COMMANDS)[number]['Type']['type'],
  Scope
>;

/** What the thread-op commands answer with; `PrReview` before `PrInfo`, which would keep only its first fields. */
const THREAD_OP_DATA = [
  PrReview,
  PrInfo,
  SyncResult,
  Schema.Struct({ bytes: Schema.Number }),
  Schema.Array(Trigger),
  PortsListing,
  RewindPreview,
] as const;

/**
 * What a device can ask this computer to do, as the `device.command` RPC's payload. Fields a command doesn't take are
 * dropped; titles and names come back trimmed.
 */
export const RemoteCommand = Schema.Union([
  command('catalog', {}),
  command('settings', {}),
  command('projects', {}),
  /**
   * The composer's send, `text` as typed. `queuedId`: Send now on a message in the machine's queue, which then goes as queued
   * there. `steers`: true sends into the turn in flight, false queues it; unset, the machine's While the agent is working.
   */
  command('send', {
    threadId: Id,
    text: Str(MAX_TEXT),
    images: messageFields.images,
    mentions: messageFields.mentions,
    isCommand: messageFields.isCommand,
    typedSkills: messageFields.typedSkills,
    queuedId: opt(Id),
    steers: opt(B),
  }).check(
    Schema.makeFilter(
      (c) =>
        c.queuedId !== undefined ||
        !!c.text.trim() ||
        !!c.images?.length ||
        !!c.mentions?.length ||
        'a message needs text, an image or a reference',
    ),
  ),
  command('thread-action', { threadId: Id, action: ThreadAction }),
  /** Takes back a message sent into the turn before the agent read it; `sendNow` instead stops the turn and sends it first. */
  command('unsteer', { threadId: Id, steerId: Id, sendNow: opt(B) }),
  /** Retry or Skip on a failed setup step, as the step's own buttons answer it. */
  command('setup-choice', {
    threadId: Id,
    choice: Schema.Literals(['retry', 'skip']),
  }),
  command('resolve', { queueId: Id, answers: opt(Answers) }),
  command('interrupt', { threadId: Id }),
  command('fork', { threadId: Id, point: ThreadPoint }),
  command('handoff', { threadId: Id, to: Provider }),
  command('rewind', {
    threadId: Id,
    point: ThreadPoint,
    mode: Schema.Literals(['chat', 'files']),
  }),
  command('side-chat', {
    threadId: Id,
    text: Text(MAX_TEXT),
    quote: opt(
      Schema.Struct({
        source: Quote.fields.source,
        label: Str(MAX_PATH),
        text: Str(MAX_TEXT),
      }),
    ),
  }),
  command('seen', {
    threadId: opt(Id),
    queueIds: opt(Schema.Array(NonEmptyId).check(Schema.isMaxLength(MAX_SEEN))),
  }).check(
    Schema.makeFilter(
      (c) =>
        c.threadId !== undefined ||
        c.queueIds !== undefined ||
        `seen needs threadId, queueIds (up to ${MAX_SEEN} ids) or both`,
    ),
  ),
  command('create', {
    title: TrimmedText(MAX_TEXT),
    provider: Provider,
    project: Schema.NullOr(Id),
    controls: opt(RemoteControls),
    images: opt(
      Schema.Array(RemoteImage).check(Schema.isMaxLength(MAX_IMAGES)),
    ),
  }),
  command('rename', { threadId: Id, title: TrimmedText(MAX_TITLE) }),
  command('pin', { threadId: Id, isPinned: B, order: opt(Schema.Finite) }),
  command('settle', { threadId: Id, isSettled: B }),
  command('schedule', {
    threadId: Id,
    action: Schema.Literals(['pause', 'resume', 'run', 'remove']),
  }),
  command('commit', { threadId: Id, message: Text(MAX_TEXT) }),
  command('push', { threadId: Id }),
  command('open-pr', {
    threadId: Id,
    title: TrimmedText(MAX_TITLE),
    body: Str(MAX_TEXT),
  }),
  command('delete', { threadId: Id }),
  command('add-project', {
    name: Str(MAX_TITLE).check(Schema.isPattern(PROJECT_NAME)),
    publish: opt(Schema.Literals(['private', 'public'])),
  }),
  command('clone-project', { source: RemoteCloneSource }),
  command('setting', { key: Text(MAX_ID), value: Str(MAX_TEXT) }),
  command('diff', { threadId: Id, scope: DiffScope }),
  command('checkpoint-diff', { threadId: Id, n: Index }),
  command('change', {
    threadId: Id,
    action: Schema.Literals(['stage', 'unstage', 'revert']),
    target: ChangeTarget,
  }),
  command('comment', {
    threadId: Id,
    path: RelativePath,
    side: Schema.Literals(['additions', 'deletions']),
    line: Index,
    text: Text(MAX_TEXT),
  }),
  command('files', { threadId: Id }),
  command('read-file', { threadId: Id, path: RelativePath }),
  command('terminal-open', { threadId: Id, cols: Size, rows: Size }),
  command('terminal-write', {
    threadId: Id,
    terminalId: Id,
    data: Str(MAX_TEXT).check(Schema.isMinLength(1)),
  }),
  command('terminal-resize', {
    threadId: Id,
    terminalId: Id,
    cols: Size,
    rows: Size,
  }),
  command('terminal-close', { threadId: Id, terminalId: Id }),
  ...PANE_COMMANDS,
  ...THREAD_OP_COMMANDS,
]);
export type RemoteCommand = typeof RemoteCommand.Type;

export const CatalogProject = Schema.Struct({ ref: S, name: S });

const MachineCommands = Schema.Struct({
  commands: Schema.Array(AgentCommand),
  skills: Schema.Array(S),
});

export const MachineCatalog = Schema.Struct({
  projects: Schema.Array(CatalogProject),
  models: Schema.Struct({
    claude: opt(Schema.Array(AgentModel)),
    codex: opt(Schema.Array(AgentModel)),
  }),
  defaults: Schema.Struct({ claude: S, codex: S }),
  /** Each harness's slash commands and skills as the profile configures them, before a thread's agent reports its own. */
  commands: opt(
    Schema.Struct({
      claude: opt(MachineCommands),
      codex: opt(MachineCommands),
    }),
  ),
});

export const TerminalOutput = Schema.Struct({
  data: S,
  next: Schema.Number,
  exitCode: opt(Schema.Number),
});

/**
 * `CommandData[keyof CommandData]`. Nothing on the wire says which command a result answers, so the all-string shapes
 * (`settings`, a catalog project, `terminal-open`) decode through the string record, which keeps every key.
 */
const CommandData = Schema.Union([
  ...PaneCommandData,
  MachineCatalog,
  GitDiff,
  Schema.Struct({ paths: Schema.Array(S), isTruncated: B }),
  Schema.Array(Project),
  Schema.Record(S, S),
  CatalogProject,
  Schema.Struct({ terminalId: S }),
  Schema.Struct({ threadId: S }),
  ...THREAD_OP_DATA,
]);

const okFields = {
  isOk: Schema.Literal(true),
  detail: opt(S),
  data: opt(CommandData),
};
const failedFields = { isOk: Schema.Literal(false), error: S };

export const CommandResult = Schema.Union([
  Schema.Struct(okFields),
  Schema.Struct(failedFields),
]);
export type CommandResult = typeof CommandResult.Type;

export const RemoteCommandRequest = Schema.Struct({
  id: S,
  deviceName: S,
  command: RemoteCommand,
});
export type RemoteCommandRequest = typeof RemoteCommandRequest.Type;

/** The scope each command needs; Core refuses it on a connection without that scope (`scopeOf` in `capabilities.ts`). */
export const COMMAND_SCOPES = {
  catalog: 'read',
  settings: 'read',
  projects: 'read',
  send: 'operate',
  // At least `operate`; each action's own scope is `THREAD_ACTION_SCOPES` (`commandScope`).
  'thread-action': 'operate',
  unsteer: 'operate',
  'setup-choice': 'operate',
  resolve: 'operate',
  interrupt: 'operate',
  fork: 'operate',
  handoff: 'operate',
  rewind: 'operate',
  'side-chat': 'operate',
  seen: 'operate',
  create: 'manage',
  rename: 'manage',
  pin: 'manage',
  settle: 'manage',
  schedule: 'manage',
  commit: 'manage',
  push: 'manage',
  'open-pr': 'manage',
  delete: 'manage',
  setting: 'manage',
  'add-project': 'manage',
  'clone-project': 'manage',
  diff: 'code',
  'checkpoint-diff': 'code',
  change: 'code',
  comment: 'code',
  files: 'code',
  'read-file': 'code',
  'terminal-open': 'terminal',
  'terminal-write': 'terminal',
  'terminal-resize': 'terminal',
  'terminal-close': 'terminal',
  'write-file': 'code',
  search: 'code',
  'turn-diff': 'code',
  'read-image': 'read',
  'read-task-output': 'read',
  ...THREAD_OP_SCOPES,
} as const satisfies Record<RemoteCommand['type'], Scope>;

/** The scope a command needs: a `thread-action` by its action, any other by its type; `local` (refused) for one unknown. */
export function commandScope(command: unknown): Scope | 'local' {
  const { type, action } = (command ?? {}) as {
    type?: RemoteCommand['type'];
    action?: { type?: ThreadAction['type'] };
  };
  const [scopes, key] =
    type === 'thread-action'
      ? [THREAD_ACTION_SCOPES, action?.type]
      : [COMMAND_SCOPES, type];
  return typeof key === 'string' && Object.hasOwn(scopes, key)
    ? scopes[key as keyof typeof scopes]
    : 'local';
}

/**
 * After pairing, a link carries Core's WebSocket RPC (frames with a `_tag`, tunnelled to the machine's Core) and these
 * few frames of its own (with a `type`), about who is at each end: the membership records spread over every link.
 */
export const HelloFrame = Schema.Struct({
  type: Schema.Literal('hello'),
  version: Schema.Number.check(
    Schema.makeFilter(
      (v: number) =>
        v === PROTOCOL_VERSION ||
        `This machine speaks protocol ${PROTOCOL_VERSION}; update Mochi on both sides`,
    ),
  ),
  /** The device's membership records, unchecked here: `members.ts` parses and weighs them. */
  members: opt(Schema.Unknown),
});
export type HelloFrame = typeof HelloFrame.Type;

/** `addresses`: where the machine listens on its LAN or Tailscale, so the device tries those before the relay next time. */
export const WelcomeFrame = Schema.Struct({
  type: Schema.Literal('welcome'),
  version: Schema.Number,
  deviceId: S,
  /** The machine's own descriptor (`backend.info`), with `scopes` what this device may do there. */
  backend: BackendInfo,
  addresses: Schema.Array(S),
  members: opt(Schema.Unknown),
});
export type WelcomeFrame = typeof WelcomeFrame.Type;

export const RefusedFrame = Schema.Struct({
  type: Schema.Literal('refused'),
  reason: S,
});

/** The sender's membership records changed (a computer joined or was removed). */
export const MembersFrame = Schema.Struct({
  type: Schema.Literal('members'),
  members: Schema.Unknown,
});

/** What the machine says on a link besides Core's RPC frames. */
export const MachineLinkFrame = Schema.Union([
  WelcomeFrame,
  RefusedFrame,
  MembersFrame,
]);
export type MachineLinkFrame = typeof MachineLinkFrame.Type;

/** A device's frame after its hello: one of Core's RPC client messages, or its membership records. */
export const DeviceLinkFrame = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literals(['Request', 'Ack', 'Interrupt', 'Ping', 'Eof']),
  }),
  MembersFrame,
]);

/**
 * A followed machine's threads as main hands them to the window, one thread file (`persist.ts` `SavedThread`) at a time
 * from that machine's `thread` streams. `null` deletes the thread; `reset` drops them all before a fresh start.
 */
export const MirrorFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal('reset') }),
  Schema.Struct({
    type: Schema.Literal('thread'),
    threadId: S,
    saved: Schema.NullOr(Schema.Unknown),
  }),
]);
export type MirrorFrame = typeof MirrorFrame.Type;

// Mirrors `isCloneUrl` / `normalizeOrigin` in src/git/origin.ts, which this package can't import.
const SCHEMES = ['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'];
const HOST = /^[\w.-]+$/;

function isCloneUrl(url: string) {
  return (
    !/[\s\0]/.test(url) && !url.startsWith('-') && isNetworkRemote(url.trim())
  );
}

function isNetworkRemote(url: string) {
  const remote = splitRemote(url);
  const path = remote?.path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return (
    !!path &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  );
}

function splitRemote(url: string) {
  if (url.includes('://')) {
    try {
      const parsed = new URL(url);
      if (!SCHEMES.includes(parsed.protocol) || !HOST.test(parsed.hostname))
        return null;
      return { path: decodeURIComponent(parsed.pathname) };
    } catch {
      return null;
    }
  }
  const scp = url.match(/^(?:[^@/\\]+@)?([^:/\\]{2,}):(?![/:])([^\\]+)$/);
  return scp && HOST.test(scp[1]) ? { path: scp[2] } : null;
}
