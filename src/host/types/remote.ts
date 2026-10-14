import type { Provider } from '../../model.ts';
import type { Manifest } from './manifest.ts';

/** What a paired device may do on this machine (DEVICES.md › Devices and what they can do). */
export const SCOPES = ['read', 'operate', 'manage', 'code', 'terminal'] as const;

export type Scope = (typeof SCOPES)[number];

/** A new device gets every scope but `terminal`: a terminal is a shell on this machine. */
export const DEFAULT_SCOPES: Scope[] = ['read', 'operate', 'manage', 'code'];

/** Settings › Devices, kept in main's userData. Off until you turn it on. */
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
  scopes: Scope[];
  pairedAt: number;
}

/** Another computer on your account, as the relay lists it. */
export interface OtherMachine {
  id: string;
  name: string;
  isOnline: boolean;
  isPaired: boolean;
  /** The six digits both screens show while pairing with it. */
  pairingCode: string;
}

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
 * (DEVICES.md › Devices and what they can do). `operate` steers threads; `manage` changes them and ships their work.
 * GAP: `code` and `terminal` commands (files, diffs, terminals), rewind, side chat, settings and delete are the next PR.
 */
export type RemoteCommand =
  // operate
  | { type: 'send'; threadId: string; text: string }
  | { type: 'resolve'; queueId: string; answers?: string[][] }
  | { type: 'interrupt'; threadId: string }
  | { type: 'fork'; threadId: string; point: { kind: 'message'; index: number } | { kind: 'checkpoint'; n: number } }
  | { type: 'handoff'; threadId: string; to: Provider }
  // manage
  | { type: 'create'; title: string; provider: Provider; /** A project ref; null for a folderless chat. */ project: string | null }
  | { type: 'rename'; threadId: string; title: string }
  | { type: 'edit-goal'; threadId: string; goal: string }
  | { type: 'pin'; threadId: string; isPinned: boolean }
  | { type: 'settle'; threadId: string; isSettled: boolean }
  | { type: 'schedule'; threadId: string; action: 'pause' | 'resume' | 'run' | 'remove' }
  | { type: 'commit'; threadId: string; message: string }
  /** Visible to others: the device asks its user first, as the machine's ship bar does. */
  | { type: 'push'; threadId: string }
  | { type: 'open-pr'; threadId: string; title: string; body: string };

export type CommandResult = { isOk: true; /** A short outcome a device can show: a commit's sha, a PR's URL. */ detail?: string } | { isOk: false; error: string };

/** A device's command as the renderer runs it. */
export interface RemoteCommandRequest {
  id: string;
  deviceName: string;
  command: RemoteCommand;
}

/**
 * Settings › Devices, and the bridge that lets the renderer (the store's only writer) stream to devices and run their commands.
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
} satisfies Manifest<RemoteHost>;
