import type { AgentCommand, Provider, SentImage } from '../../model.ts';
import type { Mention } from '../../chat/mentions.ts';
import type { ThreadControls } from '../../runtime/controls.ts';
import type { Quote } from '../../store/sidechat.ts';
import type { AgentModel } from './agent.ts';
import type {
  ChangeTarget,
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
} from './git.ts';
import type {
  SearchHits,
  SearchOptions,
  WriteResult,
} from '@mochi/domain/host/types/fs';
import type { MissedRuns, Trigger, TriggerWhen } from './schedule.ts';
import type { PortsListing } from '@mochi/domain/host/types/ports';
import type { Manifest } from '@mochi/domain/host/types/manifest';
import type { CloneSource, Project } from '@mochi/domain/host/types/projects';

/** What a paired device may do on this machine (DEVICES.md › Devices and what they can do). */
export const SCOPES = [
  'read',
  'operate',
  'manage',
  'code',
  'terminal',
] as const;

export type Scope = (typeof SCOPES)[number];

/** What a device or computer is, for its icon: from its OS, or `phone` for the phone app (later). */
export const DEVICE_KINDS = ['mac', 'windows', 'linux', 'phone'] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** A new member gets every scope but `terminal` on each computer: a terminal is a shell on that machine. */
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
  /** While devices can control it and a thread works or a device is connected, the computer doesn't sleep. */
  keepsAwake: boolean;
}

export type RelayState =
  | { status: 'off' }
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'error'; error: string };

/** Another computer among yours (DEVICES.md › Pairing), with what it may do on this one. */
export interface MemberInfo {
  /** Its key's id. */
  id: string;
  name: string;
  kind?: DeviceKind;
  scopes: Scope[];
  /** Epoch ms it was first vouched for. */
  addedAt: number;
  /** How this computer's connection to it stands, once it knows where it is. */
  machineStatus?: FollowedMachine['status'];
}

/** A computer on your account that isn't among yours yet, as the relay lists it. */
export interface OtherMachine {
  id: string;
  name: string;
  isOnline: boolean;
  /** The six digits both screens show while joining. */
  pairingCode: string;
  /** Heard on this computer's network, not only listed by the relay. */
  isNearby?: boolean;
}

/**
 * Another computer of yours that this one follows as a device. `refused`: it said no (it doesn't trust this computer yet,
 * or removed it), so nothing retries until the membership records change.
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

/** A followed machine's threads, one thread file (`SavedThread`, src/store/saved.ts) at a time; `null` deletes it. */
export type MirrorFrame =
  | { type: 'reset' }
  | { type: 'thread'; threadId: string; saved: unknown };

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
  /** Your other computers. */
  members: MemberInfo[];
  /** Another of your computers removed this one: it trusts nobody until it joins again. */
  isRemoved: boolean;
  relay: RelayState;
  /** A laptop running on its battery, where keeping awake costs charge. */
  isOnBattery: boolean;
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
  /** Every setting a device may change here (`setting`), by catalog key, as Settings reads it. */
  | { type: 'settings' }
  /** This profile's projects as that computer keeps them (its Projects page). */
  | { type: 'projects' }
  // operate
  /**
   * The composer's send, `text` as typed, its references resolved there. `queuedId`: Send now on a message in that computer's
   * queue. `steers`: true sends into the turn in flight, false queues it; unset, that computer's While the agent is working.
   */
  | ({
      type: 'send';
      threadId: string;
      text: string;
      queuedId?: string;
      steers?: boolean;
    } & Partial<Omit<RemoteMessage, 'draft'>>)
  /** One of the thread's own store actions a device may ask for, each behind its scope (`THREAD_ACTION_SCOPES`). */
  | { type: 'thread-action'; threadId: string; action: RemoteThreadAction }
  /** Takes back a message sent into the turn before the agent read it; `sendNow` stops the turn and sends it first instead. */
  | { type: 'unsteer'; threadId: string; steerId: string; sendNow?: boolean }
  /** Retry or Skip on a failed setup step. */
  | { type: 'setup-choice'; threadId: string; choice: 'retry' | 'skip' }
  | { type: 'resolve'; queueId: string; answers?: string[][] }
  | { type: 'interrupt'; threadId: string }
  | { type: 'fork'; threadId: string; point: ThreadPoint }
  | { type: 'handoff'; threadId: string; to: Provider }
  /** `chat`, or `files` too (`RewindMode`). */
  | {
      type: 'rewind';
      threadId: string;
      point: ThreadPoint;
      mode: 'chat' | 'files';
    }
  /** Asked in the thread's remote side chat on this computer (`store/remoteSideChat.ts`); the answer streams back in its thread file. */
  | { type: 'side-chat'; threadId: string; text: string; quote?: Quote }
  /** Opened on the device: the thread (with its asks) and Queue cards read here too, and on every other device. */
  | { type: 'seen'; threadId?: string; queueIds?: string[] }
  // manage
  | {
      type: 'create';
      title: string;
      provider: Provider;
      /** A project's id from `catalog`; null for a folderless chat. */
      project: string | null;
      /** Model, effort, speed and permissions as picked; unset, that computer's defaults. */
      controls?: ThreadControls;
      images?: SentImage[];
    }
  | { type: 'rename'; threadId: string; title: string }
  | { type: 'edit-goal'; threadId: string; goal: string }
  /** `order`: where the pin sorts among all your computers' pins (`pinAt`); unset pins it last. */
  | { type: 'pin'; threadId: string; isPinned: boolean; order?: number }
  | { type: 'settle'; threadId: string; isSettled: boolean }
  | {
      type: 'schedule';
      threadId: string;
      action: 'pause' | 'resume' | 'run' | 'remove';
    }
  | { type: 'commit'; threadId: string; message: string }
  /** Visible to others: the device asks its user first, as the machine's ship bar does. */
  | { type: 'push'; threadId: string }
  | { type: 'open-pr'; threadId: string; title: string; body: string }
  /** The thread and its history; its worktree stays on disk. */
  | { type: 'delete'; threadId: string }
  /** A new empty project (`git init`) in this computer's projects folder; `publish` also creates it on GitHub as the profile's gh login. */
  | { type: 'add-project'; name: string; publish?: 'private' | 'public' }
  /** Cloned into this computer's projects folder, which this computer picks: a device never names a folder here. */
  | { type: 'clone-project'; source: CloneSource }
  /** A Settings catalog row (`src/settings/catalog.ts`) on this computer only: never synced, never Devices, accounts or profiles. */
  | { type: 'setting'; key: string; value: string }
  // code
  | { type: 'diff'; threadId: string; scope: DiffScope }
  | { type: 'checkpoint-diff'; threadId: string; n: number }
  | {
      type: 'change';
      threadId: string;
      action: 'stage' | 'unstage' | 'revert';
      target: ChangeTarget;
    }
  /** A review note on a diff line, sent to the thread as the Changes tab sends it. */
  | {
      type: 'comment';
      threadId: string;
      path: string;
      side: 'additions' | 'deletions';
      line: number;
      text: string;
    }
  | { type: 'files'; threadId: string }
  | { type: 'read-file'; threadId: string; path: string }
  // terminal: a shell this computer opens in the thread's folder for the device, separate from its own terminal tabs
  | { type: 'terminal-open'; threadId: string; cols: number; rows: number }
  | {
      type: 'terminal-write';
      threadId: string;
      terminalId: string;
      data: string;
    }
  | {
      type: 'terminal-resize';
      threadId: string;
      terminalId: string;
      cols: number;
      rows: number;
    }
  /** Output from offset `after` on; the device polls with the `next` it got. */
  | { type: 'terminal-close'; threadId: string; terminalId: string }
  // the side pane on another computer's thread: saving and searching its files, turn diffs, transcript images, task output
  | {
      type: 'write-file';
      threadId: string;
      path: string;
      text: string;
      baseMtimeMs: number;
      force?: boolean;
    }
  | ({ type: 'search'; threadId: string; pattern: string } & SearchOptions)
  | { type: 'turn-diff'; threadId: string; from: string; to?: string }
  | { type: 'read-image'; threadId: string; path: string }
  | { type: 'read-task-output'; threadId: string; path: string }
  | ThreadOpCommand;

/**
 * The thread's remaining actions, run on the computer that owns it: its PR tab, worktree, schedule, project, dev servers and
 * rewind preview. Each acts only on what that thread itself has (its PRs, its folder, its ports).
 */
export type ThreadOpCommand =
  // read
  /** The open PR on the thread's branch, as `usePr` reads it; no data when there is none. */
  | { type: 'pr-status'; threadId: string }
  | { type: 'disk-usage'; threadId: string }
  /** Every trigger on that computer, without their runs: what `NextRunBadge` and the schedule editor read. */
  | { type: 'schedules' }
  | { type: 'ports'; threadId: string }
  // code
  | { type: 'pr-review'; threadId: string; number: number }
  | { type: 'rewind-preview'; threadId: string; n: number }
  // manage
  | { type: 'pr'; threadId: string; number: number; action: PrAction }
  | { type: 'sync'; threadId: string }
  | {
      type: 'schedule-set';
      threadId: string;
      name: string;
      prompt: string;
      when: TriggerWhen;
      missed: MissedRuns;
    }
  /** A project's id from `projects`: a folderless chat moves into it there. */
  | { type: 'attach-project'; threadId: string; project: string }
  /** A process listening in the thread's folder, as `ports` listed it. */
  | { type: 'port-kill'; threadId: string; pid: number };

export type PrAction =
  | { kind: 'comment'; body: string }
  | { kind: 'review'; verdict: ReviewVerdict; body: string }
  | { kind: 'reply'; reviewThreadId: string; body: string }
  | { kind: 'resolve'; reviewThreadId: string; isResolved: boolean }
  | { kind: 'merge'; method: MergeMethod; mode: MergeMode };

/** `QueuedMessage` as typed, less its id; images never name a path on the sending computer. */
export interface RemoteMessage {
  draft: string;
  images?: Omit<SentImage, 'original'>[];
  mentions?: Mention[];
  isCommand?: boolean;
  typedSkills?: string[];
}

/** The thread's store actions a device may ask for, less the thread id and what that computer stamps itself. */
export type RemoteThreadAction =
  // operate
  | { type: 'controls'; controls: ThreadControls }
  | { type: 'provider-switch'; to: Provider; model?: string }
  | { type: 'compact'; focus: string; queuedId?: string }
  | { type: 'queued-add'; message: RemoteMessage }
  | { type: 'queued-remove'; id: string }
  | { type: 'queued-order'; ids: string[] }
  | { type: 'queued-resume' }
  /** After a usage limit, on the same account: a device never switches that computer to its API key. */
  | { type: 'resume' }
  | { type: 'limit-auto-resume'; isOn: boolean }
  | {
      type: 'grant-answer';
      grantId: string;
      answer: 'allow' | 'deny' | 'revoke';
      models?: string[];
    }
  | { type: 'proposal-answer'; proposalId: string; state: 'dismissed' | 'here' }
  // manage
  | { type: 'proposal-start'; proposalId: string }
  | { type: 'goal-remove' }
  /** On from when that computer gets it. */
  | { type: 'autofix-set'; pr: number; isOn: boolean }
  | { type: 'auto-archive-set'; pr: number; isOn: boolean };

export type ThreadPoint =
  | { kind: 'message'; index: number }
  | { kind: 'checkpoint'; n: number };

/** What a command answers with, by type; the others answer with nothing beyond `isOk`. */
export interface CommandData {
  catalog: MachineCatalog;
  settings: Record<string, string>;
  projects: Project[];
  'add-project': CatalogProject;
  'clone-project': CatalogProject;
  diff: GitDiff;
  'checkpoint-diff': GitDiff;
  files: { paths: string[]; isTruncated: boolean };
  'read-file': { text: string; mtimeMs: number };
  'terminal-open': { terminalId: string };
  create: { threadId: string };
  'write-file': WriteResult;
  search: { hits: Omit<SearchHits, 'id'>[]; isTruncated: boolean };
  'turn-diff': { turnFiles: DiffFile[] };
  'read-image': { mediaType: string; base64: string };
  'read-task-output': { text: string; mtimeMs: number };
  'pr-status': PrInfo;
  'pr-review': PrReview;
  sync: SyncResult;
  'disk-usage': { bytes: number };
  schedules: Trigger[];
  ports: PortsListing;
  'rewind-preview': RewindPreview;
}

/** What a new thread on this computer can start in and with. */
export interface MachineCatalog {
  projects: CatalogProject[];
  models: Partial<Record<Provider, AgentModel[]>>;
  /** Settings › Defaults per harness; '' is the harness's own. */
  defaults: Record<Provider, string>;
  /** Each harness's slash commands and skills as the profile configures them, before a thread's agent reports its own. */
  commands?: Partial<Record<Provider, MachineCommands>>;
}

export interface MachineCommands {
  commands: AgentCommand[];
  skills: string[];
}

/** A project as a device names it: `ref` is the project's id there, sent back as is (`create`), never a path. */
export interface CatalogProject {
  ref: string;
  name: string;
}

export interface TerminalOutput {
  data: string;
  /** Where the chunk after this one starts. */
  next: number;
  /** Set once the shell exited. */
  exitCode?: number;
}

/** One push of a followed machine's terminal. */
export interface TerminalChunk extends TerminalOutput {
  machineId: string;
  terminalId: string;
}

export type CommandResult =
  | {
      isOk: true;
      /** A short outcome a device can show: a commit's sha, a PR's URL. */ detail?: string;
      data?: CommandData[keyof CommandData];
    }
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
  onCommand(listener: (request: RemoteCommandRequest) => void): () => void;
  commandResult(id: string, result: CommandResult): Promise<void>;
  /** Removes a computer from all of yours and ends its connections everywhere; it has to join again. */
  removeMember(id: string): Promise<RemoteStatus>;
  /** What a member may do here; its open connections end so the next one runs under these. */
  setDeviceScopes(id: string, scopes: Scope[]): Promise<RemoteStatus>;
  onApproval(listener: (request: ApprovalRequest) => void): () => void;
  answerApproval(id: string, isAllowed: boolean): Promise<void>;
  /** Computers on your account that aren't among yours yet, through the relay. */
  otherMachines(): Promise<OtherMachine[]>;
  /** Joins your computers through that one; resolves once it allowed this one, rejects with its reason otherwise. */
  join(machineId: string): Promise<void>;
  /** The computers this one follows, and how each connection stands. */
  machines(): Promise<FollowedMachine[]>;
  onMachines(listener: (machines: FollowedMachine[]) => void): () => void;
  /** The main window's mirrors start empty: every followed machine starts over, each thread from its snapshot. */
  follow(): Promise<void>;
  onMachineFrame(
    listener: (message: { machineId: string; frame: MirrorFrame }) => void,
  ): () => void;
  /** Output of a terminal opened on a followed machine (`terminal-open`), pushed as it prints; the last chunk of an exited shell has `exitCode`. */
  onTerminalOutput(listener: (message: TerminalChunk) => void): () => void;
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
  onCommand: 'event',
  commandResult: 'invoke',
  removeMember: 'invoke',
  setDeviceScopes: 'invoke',
  onApproval: 'event',
  answerApproval: 'invoke',
  otherMachines: 'invoke',
  join: 'invoke',
  machines: 'invoke',
  onMachines: 'event',
  follow: 'invoke',
  onMachineFrame: 'event',
  onTerminalOutput: 'event',
  cacheMachine: 'invoke',
  cachedMachines: 'invoke',
  command: 'invoke',
} satisfies Manifest<RemoteHost>;
