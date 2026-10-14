import { SCOPES, type CommandResult, type RemoteCommand, type Scope } from '../../src/host/types/remote.ts';
import { HARNESS_IDS } from '../../src/settings/harnesses.ts';

/** Bumped on any frame change; a device on another version is refused rather than misread. */
export const PROTOCOL_VERSION = 1;

/** Every command declares the scope it needs; the server refuses it on a device without that scope. */
export const COMMAND_SCOPES = {
  send: 'operate',
  resolve: 'operate',
  interrupt: 'operate',
  fork: 'operate',
  handoff: 'operate',
  create: 'manage',
  rename: 'manage',
  'edit-goal': 'manage',
  pin: 'manage',
  settle: 'manage',
  schedule: 'manage',
  commit: 'manage',
  push: 'manage',
  'open-pr': 'manage',
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
  | { type: 'welcome'; version: number; deviceId: string; machineName: string; scopes: Scope[] }
  | { type: 'refused'; reason: string }
  | { type: 'snapshot'; epoch: string; seq: number; saved: unknown }
  | { type: 'action'; epoch: string; seq: number; action: unknown }
  | ({ type: 'result'; id: string } & CommandResult);

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
      const p = c.point as Record<string, unknown> | null;
      if (!isString(c.threadId, MAX_ID)) return 'fork needs threadId';
      if (p?.kind === 'message' && isIndex(p.index)) return { type: 'fork', threadId: c.threadId, point: { kind: 'message', index: p.index } };
      if (p?.kind === 'checkpoint' && isIndex(p.n)) return { type: 'fork', threadId: c.threadId, point: { kind: 'checkpoint', n: p.n } };
      return 'fork needs a point: { kind: message, index } or { kind: checkpoint, n }';
    }
    case 'handoff':
      return isString(c.threadId, MAX_ID) && isProvider(c.to) ? { type: 'handoff', threadId: c.threadId, to: c.to } : 'handoff needs threadId and to';
    case 'create':
      if (!isText(c.title, MAX_TEXT) || !isProvider(c.provider) || !(c.project === null || isString(c.project, MAX_PATH))) return 'create needs title, provider and project (or null)';
      return { type: 'create', title: c.title.trim(), provider: c.provider, project: c.project };
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
      return isString(c.threadId, MAX_ID) && isText(c.title, MAX_TITLE) && isString(c.body, MAX_TEXT) ? { type: 'open-pr', threadId: c.threadId, title: c.title.trim(), body: c.body } : 'open-pr needs threadId, title and body';
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

// GAP: the stream carries the machine's local UI actions too (layout, panes); `multi-machine` decides which a device applies.
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
const MAX_TITLE = 256;
const MAX_PATH = 4096;

const isAnswers = (value: unknown): value is string[][] =>
  Array.isArray(value) && value.length <= 64 && value.every((a) => Array.isArray(a) && a.length <= 64 && a.every((s) => isString(s, 16 * 1024)));
