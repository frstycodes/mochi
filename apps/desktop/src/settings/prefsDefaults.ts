import type { SearchEngine } from '@mochi/domain/host/types/browser';
import type { MergeMethod } from '../host/types/git.ts';
import type { PaneTabKind } from '../model.ts';
import type { SharedAccess } from '../runtime/access.ts';
import type { ToolPolicies } from '../runtime/toolPolicy.ts';

/**
 * Renderer-only preferences (SETTINGS.md): one persisted entry, read synchronously so reducers and module code can use
 * them too. Settings the main process reads (worktree root, shell, PR drafts) live in the `settings` host instead.
 */
export interface Prefs {
  reduceMotion: 'system' | 'on' | 'off';
  /** Font families for the interface and for code (blocks, diffs, terminal); empty uses the default (`src/settings/fonts.ts`). */
  uiFont: string;
  monoFont: string;
  /** Scales every text token, not spacing. */
  uiTextSize: 'small' | 'default' | 'large';
  /** Px for code blocks and diffs; the terminal keeps `terminalFontSize`. */
  codeFontSize: number;
  /** Sidebar and side pane animations that run (`ANIMATIONS`); none by default. Reduce motion still stops them all. */
  animations: string[];
  /** Color theme ids (`src/themes/model.ts`) for light and dark appearance, like VS Code's preferred themes; `mochi` is the built-in. */
  lightTheme: string;
  darkTheme: string;
  /** Installed color theme ids, in the order you starred them: first in the theme pickers and in ⌘K. Kept when a package is removed, so reinstalling brings them back. */
  starredThemes: string[];
  projectsFolder: string;
  restoreLayout: boolean;
  /** NoticeKind values that raise an OS notification while the window is in the background. */
  alertKinds: string[];
  watchedToasts: boolean;
  dockBadge: boolean;
  /** Provider model ids. */
  starredModels: string[];
  /** A provider effort id; a model that doesn't take it runs its own default. */
  effort: string;
  /** New threads' speed: '' standard or `fast`, which runs only on models that report a faster tier. */
  speed: '' | 'fast';
  agent: 'claude' | 'codex';
  permissions: SharedAccess;
  /** Side pane tabs pinned as icons in the thread header, in order. */
  headerPins: PaneTabKind[];
  /** Sidebar destinations shown, by `SIDEBAR_ITEMS` id (Edit sidebar); the rest sit under More. */
  sidebarItems: string[];
  /** Off turns goals off everywhere: agents get no goal instructions, tools or nudge; no goal cards, checks, verdicts or drift guard. Always off: goals are retired, their code kept for now. */
  goals: boolean;
  /** Off sends every message straight through: no local score, no classifier call. */
  driftGuard: boolean;
  /** What sending does while the agent works: wait for its turn to end, or steer it now. Holding mod flips it for one send. */
  whileWorking: 'queue' | 'steer';
  /** After a turn, the report's first next-move answer in the empty composer (`suggestedReply`). */
  promptSuggestions: boolean;
  /** The end-of-turn card's turn spine: agents report assumptions and why their plan changed, the card shows them on the plan. Read at session start by agents. */
  turnSpine: boolean;
  simplifyLength: 'short' | 'detailed';
  simplifyNeedsFirst: boolean;
  simplifyRules: string;
  simplifyAuto: boolean;
  simplifyAutoWords: number;
  branchFrom: 'current' | 'base';
  /** When the agent goes idle, whether Mochi runs the goal's criterion checks (`gatherIdle`). */
  idleChecks: 'edited' | 'always' | 'off';
  /** A goal the agent proposes (`propose_goal`) waits for your Accept, or applies at once with an undo. */
  proposedGoals: 'ask' | 'apply';
  /** VerdictKind values that notify when a thread you aren't looking at goes idle. */
  idleAlerts: string[];
  branchPrefix: string;
  /** A PR a thread opens or picks up starts with Auto-fix on (`src/git/autofixToggle.ts`). */
  autofixPrs: boolean;
  /** A PR a thread opens or picks up starts with Auto-settle on (`src/git/autoArchive.ts`). */
  autoArchivePrs: boolean;
  /** Where a new project thread works: its own worktree, or the project's checkout. */
  workspaceMode: 'worktree' | 'folder';
  diffStyle: 'unified' | 'split';
  /** The PR pane's last merge method, like GitHub remembers it; a method the repo disallows falls back to its first. */
  mergeMethod: MergeMethod;
  /** Days after settling that a thread's worktree is removed (`useWorktreeCleanup`); `never` keeps them. */
  worktreeCleanup: 'never' | '1' | '7' | '30';
  /** Days after settling that a thread is deleted (`useSettledCleanup`); `never` keeps them. */
  settledCleanup: 'never' | '30' | '90' | '180';
  terminalFontSize: number;
  terminalScrollback: number;
  restoreTerminals: boolean;
  searchEngine: SearchEngine;
  /** A simulator udid; empty picks the first booted one. */
  simulator: string;
  /** Desktop only: show the fixture threads and profiles alongside your own (`showsDemoData`). */
  demoData: boolean;
  /** How far agents may change Mochi through its tools (RUNTIME.md › Mochi tools): deletes and settings always ask first. */
  agentControl: AgentControl;
  /** Per-tool choices over the level (`src/runtime/toolPolicy.ts`); a choice a tool's tier doesn't offer is ignored when read. */
  toolPolicies: ToolPolicies;
  /** Keep each live thread's agent events for Replay (`src/replay/recorder.ts`). */
  recordReplays: boolean;
  /** The rewind mode you last ran, offered first next time. */
  rewindMode: 'chat' | 'files';
  /** Rebound shortcuts only, command id → chord text (`src/keymap.ts`); '' leaves a command without one. */
  keybindings: Record<string, string>;
}

export const AGENT_CONTROLS = ['read', 'changes', 'everything'] as const;

export type AgentControl = (typeof AGENT_CONTROLS)[number];

/** Adds `id` to a starred list (models, themes) or takes it out. */
export const toggleStar = (starred: string[], id: string) =>
  starred.includes(id) ? starred.filter((x) => x !== id) : [...starred, id];

export const DEFAULT_PREFS: Prefs = {
  reduceMotion: 'system',
  uiFont: '',
  monoFont: '',
  uiTextSize: 'default',
  codeFontSize: 12,
  animations: [],
  lightTheme: 'mochi',
  darkTheme: 'mochi',
  projectsFolder: '~/dev',
  restoreLayout: true,
  goals: false,
  idleChecks: 'edited',
  proposedGoals: 'ask',
  idleAlerts: ['gaps', 'needs-you', 'stalled'],
  alertKinds: [
    'needs-you',
    'done',
    'failed',
    'limit',
    'ci',
    'pr-review',
    'run',
  ],
  watchedToasts: true,
  dockBadge: true,
  starredModels: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  starredThemes: [],
  effort: 'high',
  speed: '',
  agent: 'claude',
  permissions: 'Auto',
  headerPins: ['browser', 'terminal'],
  sidebarItems: ['queue', 'projects'],
  driftGuard: true,
  whileWorking: 'steer',
  promptSuggestions: true,
  turnSpine: true,
  simplifyLength: 'short',
  simplifyNeedsFirst: true,
  simplifyRules: '',
  simplifyAuto: false,
  simplifyAutoWords: 150,
  branchFrom: 'current',
  branchPrefix: 'mochi/',
  autofixPrs: true,
  autoArchivePrs: false,
  workspaceMode: 'worktree',
  diffStyle: 'unified',
  mergeMethod: 'squash',
  worktreeCleanup: '7',
  settledCleanup: 'never',
  terminalFontSize: 12,
  terminalScrollback: 5000,
  restoreTerminals: true,
  searchEngine: 'duckduckgo',
  simulator: '',
  demoData: false,
  agentControl: 'everything',
  toolPolicies: {},
  recordReplays: true,
  rewindMode: 'files',
  keybindings: {},
};
