import { useSyncExternalStore } from 'react';
import type { SearchEngine } from '../host/types/browser.ts';
import type { PaneTabKind } from '../model.ts';
import { accessOf, type SharedAccess } from '../runtime/access.ts';
import { effortId, modelId } from '../runtime/models.ts';
import type { ToolPolicies } from '../runtime/toolPolicy.ts';

/**
 * Renderer-only preferences (SETTINGS.md): one localStorage entry, read synchronously so reducers and module code can use
 * them too. Settings the main process reads (worktree root, shell, PR drafts) live in the `settings` host instead.
 */
export interface Prefs {
  reduceMotion: 'system' | 'on' | 'off';
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
  /** Off sends every message straight through: no local score, no classifier call. */
  driftGuard: boolean;
  /** What sending does while the agent works: wait for its turn to end, or steer it now. Holding mod flips it for one send. */
  whileWorking: 'queue' | 'steer';
  simplifyLength: 'short' | 'detailed';
  simplifyNeedsFirst: boolean;
  simplifyRules: string;
  simplifyAuto: boolean;
  simplifyAutoWords: number;
  branchFrom: 'current' | 'base';
  /** When the agent goes idle, whether Mochi runs the goal's criterion checks (`useIdleChecks`). */
  idleChecks: 'edited' | 'always' | 'off';
  /** What open_pr does with critical gaps: refuse until fixed or Open anyway, or open and list them. */
  prGaps: 'block' | 'warn';
  /** A goal the agent proposes (`propose_goal`) waits for your Accept, or applies at once with an undo. */
  proposedGoals: 'ask' | 'apply';
  /** VerdictKind values that notify when a thread you aren't looking at goes idle. */
  idleAlerts: string[];
  branchPrefix: string;
  /** Where a new project thread works: its own worktree, or the project's checkout. */
  workspaceMode: 'worktree' | 'folder';
  diffStyle: 'unified' | 'split';
  /** Days after settling that a thread's worktree is removed (`useWorktreeCleanup`); `never` keeps them. */
  worktreeCleanup: 'never' | '1' | '7' | '30';
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
  /** What model and effort `create_thread` may give a new thread (RUNTIME.md › Mochi tools). */
  threadModels: ThreadModels;
  /** Keep each live thread's agent events for Replay (`src/replay/recorder.ts`). */
  recordReplays: boolean;
  /** The rewind mode you last ran, offered first next time. */
  rewindMode: 'chat' | 'files';
  /** Rebound shortcuts only, command id → chord text (`src/keymap.ts`); '' leaves a command without one. */
  keybindings: Record<string, string>;
}

export const THREAD_MODELS_RULES = ['cheaper', 'any', 'default'] as const;

export type ThreadModels = (typeof THREAD_MODELS_RULES)[number];

export const AGENT_CONTROLS = ['read', 'changes', 'everything'] as const;

export type AgentControl = (typeof AGENT_CONTROLS)[number];

/** Adds `id` to a starred list (models, themes) or takes it out. */
export const toggleStar = (starred: string[], id: string) => (starred.includes(id) ? starred.filter((x) => x !== id) : [...starred, id]);

export const DEFAULT_PREFS: Prefs = {
  reduceMotion: 'system',
  animations: [],
  lightTheme: 'mochi',
  darkTheme: 'mochi',
  projectsFolder: '~/dev',
  restoreLayout: true,
  idleChecks: 'edited',
  proposedGoals: 'ask',
  prGaps: 'block',
  idleAlerts: ['gaps', 'needs-you', 'stalled'],
  alertKinds: ['needs-you', 'review', 'done', 'failed', 'limit', 'ci', 'pr-review', 'overlap', 'race-lost', 'run'],
  watchedToasts: true,
  dockBadge: true,
  starredModels: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  starredThemes: [],
  effort: 'high',
  speed: '',
  agent: 'claude',
  permissions: 'Auto',
  headerPins: ['browser', 'terminal'],
  sidebarItems: ['queue', 'board', 'projects'],
  driftGuard: true,
  whileWorking: 'queue',
  simplifyLength: 'short',
  simplifyNeedsFirst: true,
  simplifyRules: '',
  simplifyAuto: false,
  simplifyAutoWords: 150,
  branchFrom: 'current',
  branchPrefix: '',
  workspaceMode: 'worktree',
  diffStyle: 'unified',
  worktreeCleanup: '7',
  terminalFontSize: 12,
  terminalScrollback: 5000,
  restoreTerminals: true,
  searchEngine: 'duckduckgo',
  simulator: '',
  demoData: false,
  agentControl: 'everything',
  toolPolicies: {},
  threadModels: 'cheaper',
  recordReplays: true,
  rewindMode: 'files',
  keybindings: {},
};

export const PREFS_KEY = 'mochi.prefs.v1';
// Before this store, the drift card kept its choice under its own key.
const LEGACY_BRANCH_FROM_KEY = 'harness.drift.branchFrom';

let prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked (private window, artifact sandbox): prefs last for this session.
  }
  listeners.forEach((l) => l());
}

/** Settings › Appearance's Reduce motion, falling back to the OS setting; for code outside React (scroll behaviour). */
export function prefersReducedMotion() {
  const { reduceMotion } = prefs;
  return reduceMotion === 'system' ? matchMedia('(prefers-reduced-motion: reduce)').matches : reduceMotion === 'on';
}

/** Re-reads storage: another window (a torn-off thread) changed a pref. */
export function reloadPrefs() {
  prefs = load();
  listeners.forEach((l) => l());
}

export function subscribePrefs(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Saved values win only when they have the default's type, so a stale or hand-edited entry can't break a reader. */
export function parsePrefs(raw: string | null, legacyBranchFrom?: string | null): Prefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {}
  if (saved.branchFrom === undefined && legacyBranchFrom === 'base') saved.branchFrom = 'base';
  // 'mochi/' was the old default; branches are now `type/slug` and a prefix is something you add.
  if (saved.branchPrefix === 'mochi/') delete saved.branchPrefix;
  // 'reversible' was the old default, which refused creating and messaging threads; those now run on their own.
  if (!(AGENT_CONTROLS as readonly unknown[]).includes(saved.agentControl)) delete saved.agentControl;
  if (!(THREAD_MODELS_RULES as readonly unknown[]).includes(saved.threadModels)) delete saved.threadModels;
  if (saved.speed !== '' && saved.speed !== 'fast') delete saved.speed;
  if (!isStringRecord(saved.keybindings)) delete saved.keybindings;
  if (!isStringRecord(saved.toolPolicies)) delete saved.toolPolicies;
  const next: Record<string, unknown> = { ...DEFAULT_PREFS };
  for (const [key, fallback] of Object.entries(DEFAULT_PREFS)) {
    const value = saved[key];
    if (Array.isArray(fallback) ? Array.isArray(value) && value.every((v) => typeof v === 'string') : typeof value === typeof fallback) next[key] = value;
  }
  const prefs = next as unknown as Prefs;
  const access = accessOf(prefs.permissions);
  return { ...prefs, starredModels: prefs.starredModels.map(modelId), effort: effortId(prefs.effort), permissions: access === 'Plan' ? 'Auto' : access };
}

function load(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY), localStorage.getItem(LEGACY_BRANCH_FROM_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

// A declaration, not a const: `load()` runs at the top of this module, before a const below it would exist.
function isStringRecord(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string');
}

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === PREFS_KEY && reloadPrefs());
