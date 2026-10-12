import { useSyncExternalStore } from 'react';

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
  starredModels: string[];
  effort: 'Low' | 'Medium' | 'High' | 'Extra high';
  agent: 'claude' | 'codex';
  permissions: 'Ask first' | 'Auto edit' | 'Full access';
  runsOn: 'This Mac' | 'Studio' | 'Cloud sandbox';
  driftThreshold: number;
  branchFrom: 'current' | 'base';
  stepSize: 1 | 2 | 3;
  branchPrefix: string;
  diffStyle: 'unified' | 'split';
  terminalFontSize: number;
  terminalScrollback: number;
  restoreTerminals: boolean;
  searchEngine: 'duckduckgo' | 'google' | 'bing' | 'kagi';
  /** A simulator udid; empty picks the first booted one. */
  simulator: string;
  /** Desktop only: show the fixture threads and profiles alongside your own (`showsDemoData`). */
  demoData: boolean;
  /** How far agents may change Mochi through its tools (RUNTIME.md › Mochi tools): consequential calls always ask first. */
  agentControl: AgentControl;
}

export type AgentControl = 'read' | 'reversible' | 'everything';

export const DEFAULT_PREFS: Prefs = {
  reduceMotion: 'system',
  projectsFolder: '~/dev',
  restoreLayout: true,
  alertKinds: ['needs-you', 'review', 'ci', 'pr-review', 'overlap', 'race-lost'],
  watchedToasts: true,
  dockBadge: true,
  starredModels: ['opus-5.5', 'sonnet-5.5', 'gpt-5.5-codex'],
  effort: 'High',
  agent: 'claude',
  permissions: 'Auto edit',
  runsOn: 'This Mac',
  driftThreshold: 0.15,
  branchFrom: 'current',
  stepSize: 2,
  branchPrefix: 'feat/',
  diffStyle: 'unified',
  terminalFontSize: 12,
  terminalScrollback: 5000,
  restoreTerminals: true,
  searchEngine: 'duckduckgo',
  simulator: '',
  demoData: false,
  agentControl: 'reversible',
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
  const next: Record<string, unknown> = { ...DEFAULT_PREFS };
  for (const [key, fallback] of Object.entries(DEFAULT_PREFS)) {
    const value = saved[key];
    if (Array.isArray(fallback) ? Array.isArray(value) && value.every((v) => typeof v === 'string') : typeof value === typeof fallback) next[key] = value;
  }
  return next as unknown as Prefs;
}

function load(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY), localStorage.getItem(LEGACY_BRANCH_FROM_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === PREFS_KEY && reloadPrefs());
