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

export type Phase = 'planning' | 'building' | 'verifying' | 'ready' | 'settled';

export const GOAL_PHASE_LABELS = { planning: 'Planning', building: 'Building', verifying: 'Verifying', ready: 'Ready for review', settled: 'Settled' } satisfies Record<Phase, string>;

/**
 * The ring: criteria met out of the goal's criteria (what done means); no criteria, no count. Steps never count: they aren't
 * equal in size and a re-plan would move the count backwards. `phase` is read from what Mochi saw happen (edits, claims,
 * checks), never from the agent's own percentage.
 */
export function goalProgress(thread: Thread) {
  const criteria = thread.criteria ?? [];
  const met = criteria.filter((c) => isMet(c, thread.idle?.isConfirmed)).length;
  return { met, total: criteria.length, phase: phaseOf(thread, criteria.length > 0 && met === criteria.length) };
}

function phaseOf(thread: Thread, isAllMet: boolean): Phase {
  if (thread.status === 'settled') return 'settled';
  // `review` is a status only threads saved before the verdict decided readiness still carry (and the demo's).
  if (isAllMet || thread.status === 'review') return 'ready';
  if (thread.criteria?.some((c) => c.claim || c.check)) return 'verifying';
  if (thread.steps.some((s) => s.status === 'done' || s.status === 'running') || summarize(thread.activity).files.length) return 'building';
  return 'planning';
}

/** "Building · 1/3" with criteria, "Building" without. */
export function progressLabel(p: ReturnType<typeof goalProgress>) {
  return p.total ? `${GOAL_PHASE_LABELS[p.phase]} · ${p.met}/${p.total}` : GOAL_PHASE_LABELS[p.phase];
}

/** Each step's column on the board: its place in its thread's plan. */
export function boardColumns(lines: Step[][]): Map<string, number> {
  return new Map(lines.flatMap((steps) => steps.map((s, i) => [s.id, i] as const)));
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
