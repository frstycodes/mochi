import type { Provider } from '../../model.ts';
import type { AgentModel } from './agent.ts';
import type { ChangeTarget, DiffScope, GitDiff } from './git.ts';
import type { Manifest } from './manifest.ts';

/** What a paired device may do on this machine (DEVICES.md › Devices and what they can do). */
export const SCOPES = ['read', 'operate', 'manage', 'code', 'terminal'] as const;

export type Scope = (typeof SCOPES)[number];

/** What a device or computer is, for its icon: from its OS, or `phone` for the phone app (later). */
export const DEVICE_KINDS = ['mac', 'windows', 'linux', 'phone'] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** A new device gets every scope but `terminal`: a terminal is a shell on this machine. */
export const DEFAULT_SCOPES: Scope[] = ['read', 'operate', 'manage', 'code'];

/** Settings › Remote access, kept in main's userData. Off until you turn it on. */
export interface RemoteSettings {
  isEnabled: boolean;
  /** Binds the LAN and Tailscale addresses as well as 127.0.0.1. */
  allowsNetwork: boolean;
  /** Empty: the OS host name. */
  machineName: string;
  /** Also reachable through Mochi's relay from anywhere; needs a signed-in Mochi account. */
  reachesAnywhere: boolean;
}

export type RelayState = { status: 'off' } | { status: 'connecting' } | { status: 'connected' } | { status: 'error'; error: string };

/** A device this computer approved; only its public key, kept here and nowhere else. */
export interface PairedDeviceInfo {
  id: string;
  name: string;
  /** Missing for a device paired before devices named their kind. */
  kind?: DeviceKind;
  scopes: Scope[];
  pairedAt: number;
}

/** Another computer on your account, as the relay lists it. */
export interface OtherMachine {
  id: string;
  name: string;
  /** Known once paired: the relay doesn't list it. */
  kind?: DeviceKind;
  isOnline: boolean;
  isPaired: boolean;
  /** The six digits both screens show while pairing with it. */
  pairingCode: string;
}

/**
 * Another computer of yours that this one follows as a device. `refused`: it said no (removed this computer, or its key
 * changed), so nothing retries until you pair again.
 */
export interface FollowedMachine {
  id: string;
  name: string;
  kind?: DeviceKind;
  status: 'connecting' | 'online' | 'offline' | 'refused';
  route?: 'lan' | 'relay';
  /** What it lets this computer do; empty until it welcomed this one. */
  scopes: Scope[];
  /** Why the last attempt failed, or the machine's refusal. */
  error?: string;
  /** Epoch ms it was last online, for "offline since". */
  lastSeenAt?: number;
}

/** A machine's stream as a device applies it: a fresh base, then each store action numbered within the base's epoch. */
export type StreamFrame = { type: 'snapshot'; epoch: string; seq: number; saved: unknown } | { type: 'action'; epoch: string; seq: number; action: unknown };

/** "Allow <name>?" on this computer's screen. */
export interface ApprovalRequest {
  id: string;
  name: string;
  pairingCode: string;
  /** Epoch ms; unanswered by then counts as No. */
  expiresAt: number;
}

export interface ConnectedDevice {
  id: string;
  name: string;
  kind?: DeviceKind;
  scopes: Scope[];
  connectedAt: number;
}

export interface RemoteStatus {
  settings: RemoteSettings;
  /** What `machineName` falls back to. */
  hostName: string;
  /** `host:port` the server listens on; empty while it is off. */
  addresses: string[];
  devices: ConnectedDevice[];
  pairedDevices: PairedDeviceInfo[];
  relay: RelayState;
  /** Why the server isn't listening, when it should be (port taken, interface gone). */
  error?: string;
}

/**
 * What a device can ask this computer to do, each run through the same store action or host call the UI uses
 * (DEVICES.md › Devices and what they can do). `read` lists what a new thread can start with; `operate` steers threads;
 * `manage` changes them and ships their work; `code` reads and changes the worktree; `terminal` runs shells in it. Paths are
 * relative to the thread's folder, which only this computer resolves.
 */
export type RemoteCommand =
  // read
  | { type: 'catalog' }
  // operate
  | { type: 'send'; threadId: string; text: string }
  | { type: 'resolve'; queueId: string; answers?: string[][] }
  | { type: 'interrupt'; threadId: string }
  | { type: 'fork'; threadId: string; point: ThreadPoint }
  | { type: 'handoff'; threadId: string; to: Provider }
  /** `chat`, or `files` too (`RewindMode`). */
  | { type: 'rewind'; threadId: string; point: ThreadPoint; mode: 'chat' | 'files' }
  /** Asked in the thread's side chat on this computer; the answer streams in like any store change. */
  | { type: 'side-chat'; threadId: string; text: string }
  // manage
  | {
      type: 'create';
      title: string;
      provider: Provider;
      /** A project ref from `catalog`; null for a folderless chat. */ project: string | null;
      /** Unset: Settings › Defaults. */ model?: string;
    }
  | { type: 'rename'; threadId: string; title: string }
  | { type: 'edit-goal'; threadId: string; goal: string }
  | { type: 'pin'; threadId: string; isPinned: boolean }
  | { type: 'settle'; threadId: string; isSettled: boolean }
  | { type: 'schedule'; threadId: string; action: 'pause' | 'resume' | 'run' | 'remove' }
  | { type: 'commit'; threadId: string; message: string }
  /** Visible to others: the device asks its user first, as the machine's ship bar does. */
  | { type: 'push'; threadId: string }
  | { type: 'open-pr'; threadId: string; title: string; body: string }
  /** The thread and its history; its worktree stays on disk. */
  | { type: 'delete'; threadId: string }
  /** A Settings catalog row (`src/settings/catalog.ts`) on this computer only: never synced, never Devices, accounts or profiles. */
  | { type: 'setting'; key: string; value: string }
  // code
  | { type: 'diff'; threadId: string; scope: DiffScope }
  | { type: 'checkpoint-diff'; threadId: string; n: number }
  | { type: 'change'; threadId: string; action: 'stage' | 'unstage' | 'revert'; target: ChangeTarget }
  /** A review note on a diff line, sent to the thread as the Changes tab sends it. */
  | { type: 'comment'; threadId: string; path: string; side: 'additions' | 'deletions'; line: number; text: string }
  | { type: 'files'; threadId: string }
  | { type: 'read-file'; threadId: string; path: string }
  // terminal: a shell this computer opens in the thread's folder for the device, separate from its own terminal tabs
  | { type: 'terminal-open'; threadId: string; cols: number; rows: number }
  | { type: 'terminal-write'; threadId: string; terminalId: string; data: string }
  | { type: 'terminal-resize'; threadId: string; terminalId: string; cols: number; rows: number }
  /** Output from offset `after` on; the device polls with the `next` it got. */
  | { type: 'terminal-read'; threadId: string; terminalId: string; after: number }
  | { type: 'terminal-close'; threadId: string; terminalId: string };

export type ThreadPoint = { kind: 'message'; index: number } | { kind: 'checkpoint'; n: number };

/** What a command answers with, by type; the others answer with nothing beyond `isOk`. */
export interface CommandData {
  catalog: MachineCatalog;
  diff: GitDiff;
  'checkpoint-diff': GitDiff;
  files: { paths: string[]; isTruncated: boolean };
  'read-file': { text: string };
  'terminal-open': { terminalId: string };
  'terminal-read': TerminalOutput;
}

/** What a new thread on this computer can start in and with. */
export interface MachineCatalog {
  /** Refs as this computer names them; a device sends one back as is, and never reads it as a path. */
  projects: { ref: string; name: string }[];
  models: Partial<Record<Provider, AgentModel[]>>;
  /** Settings › Defaults per harness; '' is the harness's own. */
  defaults: Record<Provider, string>;
}

export interface TerminalOutput {
  data: string;
  /** Where the next read starts. */
  next: number;
  /** Set once the shell exited. */
  exitCode?: number;
}

export type CommandResult =
  | { isOk: true; /** A short outcome a device can show: a commit's sha, a PR's URL. */ detail?: string; data?: CommandData[keyof CommandData] }
  | { isOk: false; error: string };

/** A device's command as the renderer runs it. */
export interface RemoteCommandRequest {
  id: string;
  deviceName: string;
  command: RemoteCommand;
}

/**
 * Settings › Remote access, and the bridge that lets the renderer (the store's only writer) stream to devices and run their commands.
 * Main numbers nothing: the renderer numbers its actions within an `epoch` (one per page load and per turning streaming on).
 */
export interface RemoteHost {
  status(): Promise<RemoteStatus>;
  set(patch: Partial<RemoteSettings>): Promise<RemoteStatus>;
  onStatus(listener: (status: RemoteStatus) => void): () => void;
  /** One store action, JSON, numbered `seq` within `epoch`. */
  push(epoch: string, seq: number, action: string): Promise<void>;
  /** Answers `onSnapshotRequest`: `toSaved` JSON of the store with exactly actions 1…`seq` of `epoch` applied. */
  snapshot(requestId: string, epoch: string, seq: number, saved: string): Promise<void>;
  onSnapshotRequest(listener: (requestId: string) => void): () => void;
  onCommand(listener: (request: RemoteCommandRequest) => void): () => void;
  commandResult(id: string, result: CommandResult): Promise<void>;
  /** Forgets a paired device and ends its connections; it has to pair again. */
  removeDevice(id: string): Promise<RemoteStatus>;
  /** What a paired device may do; its open connections end so the next one runs under these. */
  setDeviceScopes(id: string, scopes: Scope[]): Promise<RemoteStatus>;
  onApproval(listener: (request: ApprovalRequest) => void): () => void;
  answerApproval(id: string, isAllowed: boolean): Promise<void>;
  /** Your account's other computers, through the relay. */
  otherMachines(): Promise<OtherMachine[]>;
  /** Pairs with another computer of yours; resolves once it allowed this one, rejects with its reason otherwise. */
  pair(machineId: string): Promise<void>;
  forgetMachine(machineId: string): Promise<void>;
  /** The computers this one follows, and how each connection stands. */
  machines(): Promise<FollowedMachine[]>;
  onMachines(listener: (machines: FollowedMachine[]) => void): () => void;
  /** The main window's mirrors start empty: every followed machine sends a fresh snapshot, then its actions. */
  follow(): Promise<void>;
  onMachineFrame(listener: (message: { machineId: string; frame: StreamFrame }) => void): () => void;
  /** Keeps a followed machine's store (`toSaved` JSON) encrypted on this computer, for launch and offline reading. */
  cacheMachine(machineId: string, saved: string): Promise<void>;
  cachedMachines(): Promise<{ machineId: string; saved: string }[]>;
  /** Runs on that machine; rejects only for a bad argument, every other failure is the result's `error`. */
  command(machineId: string, command: RemoteCommand): Promise<CommandResult>;
}

export const remoteMethods = {
  status: 'invoke',
  set: 'invoke',
  onStatus: 'event',
  push: 'invoke',
  snapshot: 'invoke',
  onSnapshotRequest: 'event',
  onCommand: 'event',
  commandResult: 'invoke',
  removeDevice: 'invoke',
  setDeviceScopes: 'invoke',
  onApproval: 'event',
  answerApproval: 'invoke',
  otherMachines: 'invoke',
  pair: 'invoke',
  forgetMachine: 'invoke',
  machines: 'invoke',
  onMachines: 'event',
  follow: 'invoke',
  onMachineFrame: 'event',
  cacheMachine: 'invoke',
  cachedMachines: 'invoke',
  command: 'invoke',
} satisfies Manifest<RemoteHost>;
