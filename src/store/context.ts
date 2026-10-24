import type { Pin, Pins } from '../chat/pins.ts';
import { DEFAULT_PREFS, type Prefs } from '../settings/prefsDefaults.ts';

/** The prefs the thread projection reads; the rest of `Prefs` is this window's own. */
export type ProjectionPrefs = Pick<Prefs, 'goals' | 'driftGuard' | 'autofixPrs' | 'autoArchivePrs' | 'workspaceMode' | 'branchPrefix'>;

/**
 * What the projection reads besides the state and the event: your prefs and pins. Core and every window fold the same events,
 * so a fold reads these from the state (`context` commands set them), never from this window's storage.
 */
export interface ProjectionContext {
  prefs: ProjectionPrefs;
  pins: Pins;
}

export const projectionPrefs = ({ goals, driftGuard, autofixPrs, autoArchivePrs, workspaceMode, branchPrefix }: ProjectionPrefs): ProjectionPrefs => ({ goals, driftGuard, autofixPrs, autoArchivePrs, workspaceMode, branchPrefix });

export const DEFAULT_CONTEXT: ProjectionContext = { prefs: projectionPrefs(DEFAULT_PREFS), pins: {} };

let ambientPrefs = (): ProjectionPrefs => DEFAULT_CONTEXT.prefs;
let ambientPins = (): Pins => DEFAULT_CONTEXT.pins;
let scoped: ProjectionContext | null = null;
let scopedMs: number | undefined;

/** Inside a fold, the state's prefs; outside one (a component rendering), this window's own (`setAmbientPrefs`). */
export const prefsNow = () => scoped?.prefs ?? ambientPrefs();

const EMPTY: Pin[] = [];
export const pinsOf = (threadId: string) => (scoped?.pins ?? ambientPins())[threadId] ?? EMPTY;

/** Wall-clock ms for what a fold stamps (a task's start): when the event was logged, so every fold of it stamps the same. */
export const wallNow = () => scopedMs ?? Date.now();

/** Runs a fold with `context` in scope, and `ms` as its wall clock. */
export function withContext<T>(context: ProjectionContext, run: () => T, ms?: number): T {
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
