import { useSyncExternalStore } from 'react';
import type { PaneTabKind } from '../model.ts';
import { accessOf, type SharedAccess } from '../runtime/access.ts';
import { effortId, modelId } from '../runtime/models.ts';

/**
 * Renderer-only preferences (SETTINGS.md): one localStorage entry, read synchronously so reducers and module code can use
 * them too. Settings the main process reads (worktree root, shell, PR drafts) live in the `settings` host instead.
 */
export interface Prefs {
  reduceMotion: 'system' | 'on' | 'off';
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
  agent: 'claude' | 'codex';
  permissions: SharedAccess;
  /** Side pane tabs pinned as icons in the thread header, in order. */
  headerPins: PaneTabKind[];
  /** Off sends every message straight through: no local score, no classifier call. */
  driftGuard: boolean;
  branchFrom: 'current' | 'base';
  stepSize: 1 | 2 | 3;
  branchPrefix: string;
  /** Where a new project thread works: its own worktree, or the project's checkout. */
  workspaceMode: 'worktree' | 'folder';
  diffStyle: 'unified' | 'split';
  terminalFontSize: number;
  terminalScrollback: number;
  restoreTerminals: boolean;
  searchEngine: 'duckduckgo' | 'google' | 'bing' | 'kagi';
  /** A simulator udid; empty picks the first booted one. */
  simulator: string;
  /** Desktop only: show the fixture threads and profiles alongside your own (`showsDemoData`). */
  demoData: boolean;
  /** How far agents may change Mochi through its tools (RUNTIME.md › Mochi tools): deletes and settings always ask first. */
  agentControl: AgentControl;
  /** What model and effort `create_thread` may give a new thread (RUNTIME.md › Mochi tools). */
  threadModels: ThreadModels;
}

export const THREAD_MODELS_RULES = ['cheaper', 'any', 'default'] as const;

export type ThreadModels = (typeof THREAD_MODELS_RULES)[number];

export const AGENT_CONTROLS = ['read', 'changes', 'everything'] as const;

export type AgentControl = (typeof AGENT_CONTROLS)[number];

export const DEFAULT_PREFS: Prefs = {
  reduceMotion: 'system',
  projectsFolder: '~/dev',
  restoreLayout: true,
  alertKinds: ['needs-you', 'review', 'done', 'failed', 'limit', 'ci', 'pr-review', 'overlap', 'race-lost', 'run'],
  watchedToasts: true,
  dockBadge: true,
  starredModels: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  effort: 'high',
  agent: 'claude',
  permissions: 'Auto',
  headerPins: ['browser', 'terminal'],
  driftGuard: true,
  branchFrom: 'current',
  stepSize: 2,
  branchPrefix: 'mochi/',
  workspaceMode: 'worktree',
  diffStyle: 'unified',
  terminalFontSize: 12,
  terminalScrollback: 5000,
  restoreTerminals: true,
  searchEngine: 'duckduckgo',
  simulator: '',
  demoData: false,
  agentControl: 'everything',
  threadModels: 'cheaper',
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

/** Settings › General's Reduce motion, falling back to the OS setting; for code outside React (scroll behaviour). */
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
  // 'reversible' was the old default, which refused creating and messaging threads; those now run on their own.
  if (!(AGENT_CONTROLS as readonly unknown[]).includes(saved.agentControl)) delete saved.agentControl;
  if (!(THREAD_MODELS_RULES as readonly unknown[]).includes(saved.threadModels)) delete saved.threadModels;
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

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === PREFS_KEY && reloadPrefs());
