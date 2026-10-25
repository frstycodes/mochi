import { browserStorage, persistedSlice } from '../lib/uiStorage.ts';
import { useSyncExternalStore } from 'react';
import { accessOf } from '../runtime/access.ts';
import { effortId, modelId } from '../runtime/models.ts';
import { AGENT_CONTROLS, DEFAULT_PREFS, type Prefs } from './prefsDefaults.ts';
import { setAmbientPrefs } from '../store/context.ts';

export {
  AGENT_CONTROLS,
  DEFAULT_PREFS,
  toggleStar,
  type AgentControl,
  type Prefs,
} from './prefsDefaults.ts';

export const PREFS_KEY = 'mochi.prefs.v1';
// Before this store, the drift card kept its choice under its own key.
const LEGACY_BRANCH_FROM_KEY = 'harness.drift.branchFrom';

const prefsSlice = persistedSlice(PREFS_KEY, DEFAULT_PREFS, (raw) =>
  parsePrefs(raw, browserStorage.getItem(LEGACY_BRANCH_FROM_KEY)),
);
let prefs = prefsSlice.getState().value;
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

setAmbientPrefs(getPrefs);

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  prefsSlice.setState({ value: prefs });
  listeners.forEach((l) => l());
}

/** Settings › Appearance's Reduce motion, falling back to the OS setting; for code outside React (scroll behaviour). */
export function prefersReducedMotion() {
  const { reduceMotion } = prefs;
  return reduceMotion === 'system'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : reduceMotion === 'on';
}

/** Re-reads storage: another window (a torn-off thread) changed a pref. */
export function reloadPrefs() {
  void prefsSlice.persist.rehydrate();
  prefs = prefsSlice.getState().value;
  listeners.forEach((l) => l());
}

export function subscribePrefs(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Saved values win only when they have the default's type, so a stale or hand-edited entry can't break a reader. */
export function parsePrefs(
  raw: string | null,
  legacyBranchFrom?: string | null,
): Prefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      saved = parsed as Record<string, unknown>;
  } catch {}
  if (saved.branchFrom === undefined && legacyBranchFrom === 'base')
    saved.branchFrom = 'base';
  // '' was the old default, saved with every pref since; a temp name needs the prefix to stand apart from your branches.
  if (saved.branchPrefix === '') delete saved.branchPrefix;
  // 'reversible' was the old default, which refused creating and messaging threads; those now run on their own.
  if (!(AGENT_CONTROLS as readonly unknown[]).includes(saved.agentControl))
    delete saved.agentControl;
  if (saved.speed !== '' && saved.speed !== 'fast') delete saved.speed;
  if (!isStringRecord(saved.keybindings)) delete saved.keybindings;
  if (!isStringRecord(saved.toolPolicies)) delete saved.toolPolicies;
  // GAP: goals are retired (2026-10-20) and have no setting; a saved `true` from before must not bring them back.
  delete saved.goals;
  const next: Record<string, unknown> = { ...DEFAULT_PREFS };
  for (const [key, fallback] of Object.entries(DEFAULT_PREFS)) {
    const value = saved[key];
    if (
      Array.isArray(fallback)
        ? Array.isArray(value) && value.every((v) => typeof v === 'string')
        : typeof value === typeof fallback
    )
      next[key] = value;
  }
  const prefs = next as unknown as Prefs;
  const access = accessOf(prefs.permissions);
  return {
    ...prefs,
    starredModels: prefs.starredModels.map(modelId),
    effort: effortId(prefs.effort),
    permissions: access === 'Plan' ? 'Auto' : access,
  };
}

function isStringRecord(value: unknown) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

if (typeof window !== 'undefined')
  window.addEventListener(
    'storage',
    (e) => e.key === PREFS_KEY && reloadPrefs(),
  );
