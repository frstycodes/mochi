import type { Pin, Pins } from '../chat/pins.ts';
import type { Space } from '../model.ts';
import { DEFAULT_PREFS, type Prefs } from '../settings/prefsDefaults.ts';

/** The prefs the thread projection and Core's reactor rules read; the rest of `Prefs` is this window's own. */
export type ProjectionPrefs = Pick<
  Prefs,
  | 'goals'
  | 'driftGuard'
  | 'autofixPrs'
  | 'autoArchivePrs'
  | 'workspaceMode'
  | 'branchPrefix'
  | 'idleChecks'
  | 'simplifyAuto'
  | 'simplifyAutoWords'
  | 'whileWorking'
>;

/**
 * What the projection reads besides the state and the event: your prefs, pins and profiles. Core keeps them in its settings
 * store (`settings`/`shared`) and every window folds with them, so a fold reads these from the state (`context` commands set
 * them), never from this window's storage. `profiles` is unset until the first window migrates its own (src/store/index.tsx).
 */
export interface ProjectionContext {
  prefs: ProjectionPrefs;
  pins: Pins;
  profiles?: Space[];
}

export const projectionPrefs = ({
  goals,
  driftGuard,
  autofixPrs,
  autoArchivePrs,
  workspaceMode,
  branchPrefix,
  idleChecks,
  simplifyAuto,
  simplifyAutoWords,
  whileWorking,
}: ProjectionPrefs): ProjectionPrefs => ({
  goals,
  driftGuard,
  autofixPrs,
  autoArchivePrs,
  workspaceMode,
  branchPrefix,
  idleChecks,
  simplifyAuto,
  simplifyAutoWords,
  whileWorking,
});

/**
 * What a window's first sync sends Core: its own context when Core holds none, Core's plus `stored` profiles when Core holds
 * no profiles yet (prefs and pins migrated before profiles did), else nothing. Lossless: `stored` is the window's whole list.
 */
export function migratedContext(
  held: ProjectionContext | null,
  local: ProjectionContext,
  stored: () => Space[],
): ProjectionContext | null {
  if (!held) return { ...local, profiles: stored() };
  if (!held.profiles) return { ...held, profiles: stored() };
  return null;
}

export const DEFAULT_CONTEXT: ProjectionContext = {
  prefs: projectionPrefs(DEFAULT_PREFS),
  pins: {},
};

let ambientPrefs = (): ProjectionPrefs => DEFAULT_CONTEXT.prefs;
let ambientPins = (): Pins => DEFAULT_CONTEXT.pins;
let ambientProfiles = (): Space[] => [];
let scoped: ProjectionContext | null = null;
let scopedMs: number | undefined;

/** Inside a fold, the state's prefs; outside one (a component rendering), this window's own (`setAmbientPrefs`). */
export const prefsNow = () => scoped?.prefs ?? ambientPrefs();

/** Inside a fold or Core's command (`withContext`), the state's profiles; outside one, this window's (`setAmbientProfiles`). */
export const profilesNow = () => scoped?.profiles ?? ambientProfiles();

const EMPTY: Pin[] = [];
export const pinsOf = (threadId: string) =>
  (scoped?.pins ?? ambientPins())[threadId] ?? EMPTY;

/** Wall-clock ms for what a fold stamps (a task's start): when the event was logged, so every fold of it stamps the same. */
export const wallNow = () => scopedMs ?? Date.now();

/** Runs a fold with `context` in scope, and `ms` as its wall clock. */
export function withContext<T>(
  context: ProjectionContext,
  run: () => T,
  ms?: number,
): T {
  const outer = { scoped, scopedMs };
  scoped = context;
  scopedMs = ms;
  try {
    return run();
  } finally {
    ({ scoped, scopedMs } = outer);
  }
}

export function setAmbientPrefs(read: () => ProjectionPrefs) {
  ambientPrefs = read;
}

export function setAmbientPins(read: () => Pins) {
  ambientPins = read;
}

export function setAmbientProfiles(read: () => Space[]) {
  ambientProfiles = read;
}
