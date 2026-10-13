import { isMet, type Step, type StepStatus, type Thread } from './model.ts';
import { summarize } from './summary.ts';

export function statusAt(step: Step, t: number): StepStatus | null {
  if (step.addedAt > t) return null;
  if (step.droppedAt !== undefined && step.droppedAt <= t) return 'dropped';
  if (step.doneAt !== undefined && step.doneAt <= t) return 'done';
  const finishedLater = step.status === 'done' || step.status === 'dropped';
  if (step.startedAt !== undefined && step.startedAt <= t) return finishedLater ? 'running' : step.status;
  if (finishedLater || step.status === 'running') return 'ready';
  return step.status;
}

export interface Progress {
  scope: number;
  done: number;
  partial: number;
  pct: number;
}

export function progressAt(thread: Thread, t: number, isLive: boolean): Progress {
  let scope = 0;
  let done = 0;
  let partial = 0;
  for (const step of thread.steps) {
    const status = statusAt(step, t);
    if (!status || status === 'dropped') continue;
    // Every step counts the same: agents' plans have no honest sizes.
    scope += 1;
    if (status === 'done') done += 1;
    else if (isLive) partial += step.progress;
  }
  const pct = scope === 0 ? 0 : (done + partial) / scope;
  return { scope, done, partial, pct };
}

export interface BurnPoint {
  t: number;
  scope: number;
  done: number;
}

export function burnSeries(thread: Thread, now: number): BurnPoint[] {
  const times = new Set<number>([thread.startedAt, now]);
  for (const step of thread.steps) {
    for (const t of [step.addedAt, step.doneAt, step.droppedAt]) if (t !== undefined && t <= now) times.add(t);
  }
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const { scope, done } = progressAt(thread, t, false);
      return { t, scope, done };
    });
}

export type Phase = 'planning' | 'building' | 'verifying' | 'ready' | 'settled';

export const GOAL_PHASE_LABELS = { planning: 'Planning', building: 'Building', verifying: 'Verifying', ready: 'Ready for review', settled: 'Settled' } satisfies Record<Phase, string>;

/**
 * The ring: criteria met when the goal has criteria (what done means), else plan steps done. `phase` is read from what
 * Mochi saw happen (edits, claims, checks), never from the agent's own percentage.
 */
export function goalProgress(thread: Thread, now: number) {
  const criteria = thread.criteria ?? [];
  const met = criteria.filter(isMet).length;
  const pct = criteria.length ? met / criteria.length : progressAt(thread, now, true).pct;
  return { pct, met, total: criteria.length, phase: phaseOf(thread, criteria.length > 0 && met === criteria.length) };
}

function phaseOf(thread: Thread, isAllMet: boolean): Phase {
  if (thread.status === 'settled') return 'settled';
  if (isAllMet || thread.status === 'review') return 'ready';
  if (thread.criteria?.some((c) => c.claim || c.check)) return 'verifying';
  if (thread.steps.some((s) => s.status === 'done' || s.status === 'running') || summarize(thread.activity).files.length) return 'building';
  return 'planning';
}

/** "Building · 1/3" with criteria, "Building · 40%" without. */
export function progressLabel(p: ReturnType<typeof goalProgress>) {
  return `${GOAL_PHASE_LABELS[p.phase]} · ${p.total ? `${p.met}/${p.total}` : `${Math.round(p.pct * 100)}%`}`;
}

export function boardColumns(lines: Step[][]): Map<string, number> {
  const cols = new Map<string, number>();
  for (const steps of lines) steps.forEach((s, i) => cols.set(s.id, i));

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const byKey = new Map<string, Step[]>();
    for (const steps of lines) for (const s of steps) if (s.sharedKey) byKey.set(s.sharedKey, [...(byKey.get(s.sharedKey) ?? []), s]);
    for (const members of byKey.values()) {
      const col = Math.max(...members.map((s) => cols.get(s.id)!));
      for (const s of members) {
        if (cols.get(s.id) === col) continue;
        cols.set(s.id, col);
        changed = true;
      }
    }
    for (const steps of lines) {
      for (let i = 1; i < steps.length; i++) {
        const min = cols.get(steps[i - 1].id)! + 1;
        if (cols.get(steps[i].id)! >= min) continue;
        cols.set(steps[i].id, min);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return cols;
}

export function clock(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function duration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "1 minute ago", "3 hours ago", "yesterday" for something `minutes` old. */
export function timeAgo(minutes: number) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return RELATIVE.format(-Math.round(minutes), 'minute');
  if (minutes < 24 * 60) return RELATIVE.format(-Math.round(minutes / 60), 'hour');
  return RELATIVE.format(-Math.round(minutes / (24 * 60)), 'day');
}

const STOP = new Set(['the', 'and', 'for', 'with', 'into', 'add', 'from', 'that', 'this', 'per']);

export function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/s$/, '')),
  );
}

export function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}
