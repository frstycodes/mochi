import type { ChangeTarget } from '../../src/host/types/git.ts';
import {
  DEVICE_KINDS,
  SCOPES,
  type CommandResult,
  type DeviceKind,
  type RemoteCommand,
  type Scope,
  type StreamFrame,
  type ThreadPoint,
} from '../../src/host/types/remote.ts';
import { HARNESS_IDS } from '../../src/settings/harnesses.ts';

/** Bumped on any frame change; a device on another version is refused rather than misread. */
export const PROTOCOL_VERSION = 2;

/** Every command declares the scope it needs; the server refuses it on a device without that scope. */
export const COMMAND_SCOPES = {
  catalog: 'read',
  send: 'operate',
  resolve: 'operate',
  interrupt: 'operate',
  fork: 'operate',
  handoff: 'operate',
  rewind: 'operate',
  'side-chat': 'operate',
  create: 'manage',
  rename: 'manage',
  'edit-goal': 'manage',
  pin: 'manage',
  settle: 'manage',
  schedule: 'manage',
  commit: 'manage',
  push: 'manage',
  'open-pr': 'manage',
  delete: 'manage',
  setting: 'manage',
  diff: 'code',
  'checkpoint-diff': 'code',
  change: 'code',
  comment: 'code',
  files: 'code',
  'read-file': 'code',
  'terminal-open': 'terminal',
  'terminal-write': 'terminal',
  'terminal-resize': 'terminal',
  'terminal-read': 'terminal',
  'terminal-close': 'terminal',
} satisfies Record<RemoteCommand['type'], Scope>;

/** The first frame once paired (`pairing.ts`). `resume` is where the device left off; without it, or past the log, it gets a snapshot. */
export interface HelloFrame {
  type: 'hello';
  version: number;
  resume?: { epoch: string; seq: number };
}

export interface CommandFrame {
  type: 'command';
  /** The device's own id for this command: a resend after a dropped connection runs once. */
  id: string;
  command: RemoteCommand;
}

export type ServerFrame =
  /** `addresses`: where the machine listens on its LAN or Tailscale, so the device tries those before the relay next time. */
  | { type: 'welcome'; version: number; deviceId: string; machineName: string; machineKind: DeviceKind; scopes: Scope[]; addresses: string[] }
  | { type: 'refused'; reason: string }
  | StreamFrame
  | ({ type: 'result'; id: string } & CommandResult);

/** A command's result over this is refused rather than sent: past it a pane is better read on the machine itself. */
export const MAX_RESULT_BYTES = 8 * 1024 * 1024;

/** The result frame, or a refusal naming its size when it wouldn't fit. */
export function resultFrame(id: string, result: CommandResult): ServerFrame {
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes <= MAX_RESULT_BYTES) return { type: 'result', id, ...result };
  return { type: 'result', id, isOk: false, error: `Too large to send here (${(bytes / 1024 / 1024).toFixed(1)} MB); open it on that computer` };
}

const MAX_ID = 128;
const MAX_TEXT = 256 * 1024;

/** Device frames are untrusted: anything off-shape becomes an error string, never a half-read command. */
export function parseHello(raw: string): HelloFrame | string {
  const frame = parseJson(raw);
  if (frame?.type !== 'hello') return 'The first frame must be hello';
  if (frame.version !== PROTOCOL_VERSION) return `This machine speaks protocol ${PROTOCOL_VERSION}; update Mochi on both sides`;
  const resume = frame.resume as Record<string, unknown> | undefined;
  if (resume === undefined) return { type: 'hello', version: PROTOCOL_VERSION };
  if (!isString(resume?.epoch, MAX_ID) || !resume.epoch || !Number.isSafeInteger(resume.seq) || (resume.seq as number) < 0) return 'resume must be { epoch, seq }';
  return { type: 'hello', version: PROTOCOL_VERSION, resume: { epoch: resume.epoch, seq: resume.seq as number } };
}

/** This computer's kind, from its OS. */
export const THIS_KIND: DeviceKind = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';

/** A kind from the other side, or undefined for one this version doesn't know. */
export const asKind = (value: unknown): DeviceKind | undefined => (DEVICE_KINDS.includes(value as never) ? (value as DeviceKind) : undefined);

/** A machine's frame on the device. The machine proved its key at pairing, so only the shape is checked. */
export function parseServerFrame(raw: string): ServerFrame | null {
  const frame = parseJson(raw);
  return SERVER_FRAMES.includes(frame?.type as never) ? (frame as unknown as ServerFrame) : null;
}

const SERVER_FRAMES = ['welcome', 'refused', 'snapshot', 'action', 'result'] satisfies ServerFrame['type'][];

export function parseCommand(raw: string): CommandFrame | string {
  const frame = parseJson(raw);
  if (frame?.type !== 'command') return 'Expected a command frame';
  if (!isString(frame.id, MAX_ID) || !frame.id) return 'A command needs an id';
  const command = parseRemoteCommand(frame.command);
  return typeof command === 'string' ? command : { type: 'command', id: frame.id, command };
}

function parseRemoteCommand(value: unknown): RemoteCommand | string {
  const c = value as Record<string, unknown> | null;
  switch (c?.type) {
    case 'send':
      return isString(c.threadId, MAX_ID) && isString(c.text, MAX_TEXT) && c.text.trim() ? { type: 'send', threadId: c.threadId, text: c.text } : 'send needs threadId and text';
    case 'interrupt':
      return isString(c.threadId, MAX_ID) ? { type: 'interrupt', threadId: c.threadId } : 'interrupt needs threadId';
    case 'resolve':
      if (!isString(c.queueId, MAX_ID)) return 'resolve needs queueId';
      if (c.answers === undefined) return { type: 'resolve', queueId: c.queueId };
      return isAnswers(c.answers) ? { type: 'resolve', queueId: c.queueId, answers: c.answers } : 'answers must be lists of strings';
    case 'fork': {
      if (!isString(c.threadId, MAX_ID)) return 'fork needs threadId';
      const point = parsePoint(c.point);
      return point ? { type: 'fork', threadId: c.threadId, point } : 'fork needs a point: { kind: message, index } or { kind: checkpoint, n }';
    }
    case 'handoff':
      return isString(c.threadId, MAX_ID) && isProvider(c.to) ? { type: 'handoff', threadId: c.threadId, to: c.to } : 'handoff needs threadId and to';
    case 'rewind': {
      const point = parsePoint(c.point);
      if (!isString(c.threadId, MAX_ID) || !point || !REWIND_MODES.includes(c.mode as never)) return 'rewind needs threadId, a point and mode: chat or files';
      return { type: 'rewind', threadId: c.threadId, point, mode: c.mode as (typeof REWIND_MODES)[number] };
    }
    case 'side-chat':
      return isString(c.threadId, MAX_ID) && isText(c.text, MAX_TEXT)
        ? { type: 'side-chat', threadId: c.threadId, text: c.text }
        : 'side-chat needs threadId and text';
    case 'catalog':
      return { type: 'catalog' };
    case 'create':
      if (
        !isText(c.title, MAX_TEXT) ||
        !isProvider(c.provider) ||
        !(c.project === null || isString(c.project, MAX_PATH)) ||
        !(c.model === undefined || isString(c.model, MAX_ID))
      )
        return 'create needs title, provider, project (or null) and an optional model';
      return { type: 'create', title: c.title.trim(), provider: c.provider, project: c.project, ...(c.model !== undefined && { model: c.model }) };
    case 'rename':
      return isString(c.threadId, MAX_ID) && isText(c.title, MAX_TITLE) ? { type: 'rename', threadId: c.threadId, title: c.title.trim() } : 'rename needs threadId and title';
    case 'edit-goal':
      return isString(c.threadId, MAX_ID) && isText(c.goal, MAX_TEXT) ? { type: 'edit-goal', threadId: c.threadId, goal: c.goal.trim() } : 'edit-goal needs threadId and goal';
    case 'pin':
      return isString(c.threadId, MAX_ID) && typeof c.isPinned === 'boolean' ? { type: 'pin', threadId: c.threadId, isPinned: c.isPinned } : 'pin needs threadId and isPinned';
    case 'settle':
      return isString(c.threadId, MAX_ID) && typeof c.isSettled === 'boolean' ? { type: 'settle', threadId: c.threadId, isSettled: c.isSettled } : 'settle needs threadId and isSettled';
    case 'schedule':
      return isString(c.threadId, MAX_ID) && SCHEDULE_ACTIONS.includes(c.action as never) ? { type: 'schedule', threadId: c.threadId, action: c.action as (typeof SCHEDULE_ACTIONS)[number] } : `schedule needs threadId and action: ${SCHEDULE_ACTIONS.join(', ')}`;
    case 'commit':
      return isString(c.threadId, MAX_ID) && isText(c.message, MAX_TEXT) ? { type: 'commit', threadId: c.threadId, message: c.message } : 'commit needs threadId and message';
    case 'push':
      return isString(c.threadId, MAX_ID) ? { type: 'push', threadId: c.threadId } : 'push needs threadId';
    case 'open-pr':
      return isString(c.threadId, MAX_ID) && isText(c.title, MAX_TITLE) && isString(c.body, MAX_TEXT)
        ? { type: 'open-pr', threadId: c.threadId, title: c.title.trim(), body: c.body }
        : 'open-pr needs threadId, title and body';
    case 'delete':
      return isString(c.threadId, MAX_ID) ? { type: 'delete', threadId: c.threadId } : 'delete needs threadId';
    case 'setting':
      return isText(c.key, MAX_ID) && isString(c.value, MAX_TEXT) ? { type: 'setting', key: c.key, value: c.value } : 'setting needs key and value';
    case 'diff':
      return isString(c.threadId, MAX_ID) && DIFF_SCOPES.includes(c.scope as never)
        ? { type: 'diff', threadId: c.threadId, scope: c.scope as (typeof DIFF_SCOPES)[number] }
        : 'diff needs threadId and scope: branch or uncommitted';
    case 'checkpoint-diff':
      return isString(c.threadId, MAX_ID) && isIndex(c.n) ? { type: 'checkpoint-diff', threadId: c.threadId, n: c.n } : 'checkpoint-diff needs threadId and n';
    case 'change': {
      const target = parseTarget(c.target);
      if (!isString(c.threadId, MAX_ID) || !CHANGE_ACTIONS.includes(c.action as never) || !target)
        return 'change needs threadId, action (stage, unstage or revert) and a target { path, staged }';
      return { type: 'change', threadId: c.threadId, action: c.action as (typeof CHANGE_ACTIONS)[number], target };
    }
    case 'comment':
      if (!isString(c.threadId, MAX_ID) || !isRelativePath(c.path) || !NOTE_SIDES.includes(c.side as never) || !isIndex(c.line) || !isText(c.text, MAX_TEXT))
        return 'comment needs threadId, a relative path, side, line and text';
      return { type: 'comment', threadId: c.threadId, path: c.path, side: c.side as (typeof NOTE_SIDES)[number], line: c.line, text: c.text };
    case 'files':
      return isString(c.threadId, MAX_ID) ? { type: 'files', threadId: c.threadId } : 'files needs threadId';
    case 'read-file':
      return isString(c.threadId, MAX_ID) && isRelativePath(c.path)
        ? { type: 'read-file', threadId: c.threadId, path: c.path }
        : 'read-file needs threadId and a path relative to the thread’s folder';
    case 'terminal-open':
      return isString(c.threadId, MAX_ID) && isSize(c.cols) && isSize(c.rows)
        ? { type: 'terminal-open', threadId: c.threadId, cols: c.cols, rows: c.rows }
        : 'terminal-open needs threadId, cols and rows';
    case 'terminal-write':
      return isString(c.threadId, MAX_ID) && isString(c.terminalId, MAX_ID) && isString(c.data, MAX_TEXT) && !!c.data
        ? { type: 'terminal-write', threadId: c.threadId, terminalId: c.terminalId, data: c.data }
        : 'terminal-write needs threadId, terminalId and data';
    case 'terminal-resize':
      return isString(c.threadId, MAX_ID) && isString(c.terminalId, MAX_ID) && isSize(c.cols) && isSize(c.rows)
        ? { type: 'terminal-resize', threadId: c.threadId, terminalId: c.terminalId, cols: c.cols, rows: c.rows }
        : 'terminal-resize needs threadId, terminalId, cols and rows';
    case 'terminal-read':
      return isString(c.threadId, MAX_ID) && isString(c.terminalId, MAX_ID) && isIndex(c.after)
        ? { type: 'terminal-read', threadId: c.threadId, terminalId: c.terminalId, after: c.after }
        : 'terminal-read needs threadId, terminalId and after';
    case 'terminal-close':
      return isString(c.threadId, MAX_ID) && isString(c.terminalId, MAX_ID)
        ? { type: 'terminal-close', threadId: c.threadId, terminalId: c.terminalId }
        : 'terminal-close needs threadId and terminalId';
    default:
      return `Unknown command ${JSON.stringify(c?.type)}`;
  }
}

export const hasScope = (scopes: readonly Scope[], command: RemoteCommand) => scopes.includes(COMMAND_SCOPES[command.type]);

export function isScopes(value: unknown): value is Scope[] {
  return Array.isArray(value) && value.every((s) => (SCOPES as readonly unknown[]).includes(s));
}

/** The parts of a `toSaved` snapshot the scope filter reads; the rest passes through untouched. */
interface SavedShape {
  threads: { activity: { patch?: string }[] }[];
  checkpoints: Record<string, unknown>;
}

/**
 * Without `code` a device gets no diffs: tool patches and checkpoints (whole thread copies tied to worktree refs) stay home.
 * Without `read` it gets no stream at all; the server never calls this then.
 */
export function visibleSnapshot<T extends SavedShape>(saved: T, scopes: readonly Scope[]): T {
  if (scopes.includes('code')) return saved;
  return { ...saved, threads: saved.threads.map((t) => ({ ...t, activity: t.activity.map(({ patch: _patch, ...entry }) => entry) })), checkpoints: {} };
}

/**
 * The stream carries the machine's local UI actions too (layout, panes). A device applies every action through the store's
 * own reducer to a scratch store and reads only its threads and queue (`src/remote/mirror.ts`), so they move nothing there.
 */
export function visibleAction(action: unknown, scopes: readonly Scope[]): unknown {
  if (scopes.includes('code')) return action;
  const a = action as { type?: string; event?: { type?: string; patch?: string } };
  if (a?.type === 'agent' && a.event?.type === 'tool' && a.event.patch !== undefined) {
    const { patch: _patch, ...event } = a.event;
    return { ...a, event };
  }
  return action;
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
/** A string with something in it besides whitespace. */
const isText = (value: unknown, max: number): value is string => isString(value, max) && !!value.trim();
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isProvider = (value: unknown): value is (typeof HARNESS_IDS)[number] => HARNESS_IDS.includes(value as never);
const SCHEDULE_ACTIONS = ['pause', 'resume', 'run', 'remove'] as const;
const REWIND_MODES = ['chat', 'files'] as const;
const DIFF_SCOPES = ['branch', 'uncommitted'] as const;
const CHANGE_ACTIONS = ['stage', 'unstage', 'revert'] as const;
const NOTE_SIDES = ['additions', 'deletions'] as const;
const MAX_PATCH = 512 * 1024;
const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1000;

/**
 * A path inside the thread's folder as this computer lists it: posix separators, nothing absolute, no `..`. Main rejects
 * anything resolving outside the folder anyway (`src/host/types/fs.ts`); this refuses it before it gets that far.
 */
export const isRelativePath = (value: unknown): value is string =>
  isText(value, MAX_PATH) && !value.includes('\\') && !value.includes('\0') && !/^([a-zA-Z]:|\/)/.test(value) && !value.split('/').includes('..');

function parsePoint(value: unknown): ThreadPoint | null {
  const p = value as Record<string, unknown> | null;
  if (p?.kind === 'message' && isIndex(p.index)) return { kind: 'message', index: p.index };
  if (p?.kind === 'checkpoint' && isIndex(p.n)) return { kind: 'checkpoint', n: p.n };
  return null;
}

function parseTarget(value: unknown): ChangeTarget | null {
  const t = value as Record<string, unknown> | null;
  if (!isRelativePath(t?.path) || typeof t.staged !== 'boolean') return null;
  if (t.untracked !== undefined && typeof t.untracked !== 'boolean') return null;
  if (t.patch !== undefined && !isString(t.patch, MAX_PATCH)) return null;
  return {
    path: t.path,
    staged: t.staged,
    ...(t.untracked !== undefined && { untracked: t.untracked as boolean }),
    ...(t.patch !== undefined && { patch: t.patch as string }),
  };
}
const MAX_TITLE = 256;
const MAX_PATH = 4096;

const isAnswers = (value: unknown): value is string[][] =>
  Array.isArray(value) && value.length <= 64 && value.every((a) => Array.isArray(a) && a.length <= 64 && a.every((s) => isString(s, 16 * 1024)));
