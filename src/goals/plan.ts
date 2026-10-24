import type { Step, StepStatus } from '../model.ts';
import { duration, formatElapsed } from '../progress.ts';

/**
 * A row of the chat's to-do list. `update_plan` sends pending / in_progress / completed; Mochi adds the rest from the thread:
 * - `running`: in progress while the agent works; the only status that moves (spinning ring, shimmer, ticking clock).
 * - `paused`: in progress, but the turn ended or the agent isn't working; its clock stops where the turn did.
 * - `blocked`: waiting on you, with why in `note`.
 * - `pending`, `done`: up next, finished. Dropped steps leave the list.
 */
export interface PlanItem {
  title: string;
  status: 'done' | 'running' | 'paused' | 'blocked' | 'pending';
  /** From start to done, or to now while it runs; none until it starts. */
  ms?: number;
  note?: string;
}

/** The agent's plan as the chat's to-do list. `now` is Mochi's minute clock, `nowMs` the wall clock. */
export function planItems(steps: Step[], now: number, nowMs: number, isWorking: boolean): PlanItem[] {
  return steps.flatMap((s) => {
    if (s.status === 'dropped') return [];
    const ms = stepElapsedMs(s, now, nowMs);
    const status = s.status === 'running' && !(isWorking && isTicking(s)) ? 'paused' : PLAN_STATUS[s.status];
    return [{ title: s.title, status, ...(ms !== undefined && { ms }), ...(s.status === 'blocked' && !!s.note && { note: s.note }) }];
  });
}

/** Every step done: the plan has nothing left to show. An empty plan counts as complete. */
export function isPlanComplete(items: PlanItem[]) {
  return items.every((i) => i.status === 'done');
}

/** Wall-clock ms for a step the agent stamped; a demo step, or one finished or stopped by an action without `ms`, has only Mochi's minute clock. */
export function stepElapsedMs(step: Step, now: number, nowMs: number) {
  const { startedMs, doneAt, stoppedAt } = step;
  const endMs = doneAt !== undefined ? step.doneMs : stoppedAt !== undefined ? step.stoppedMs : nowMs;
  if (startedMs !== undefined && endMs !== undefined) return Math.max(0, endMs - startedMs);
  if (step.startedAt !== undefined) return ((doneAt ?? stoppedAt ?? now) - step.startedAt) * 60_000;
}

/** A running step whose clock still moves: the turn it runs in hasn't ended. */
export function isTicking(step: Step) {
  return step.status === 'running' && step.stoppedAt === undefined;
}

/** "42s", then "1m 05s" while it runs (seconds tick) and "12m" once done, then "1h 3m". */
export function planDuration(ms: number, isRunning: boolean) {
  if (isRunning || ms < 60_000) return formatElapsed(ms);
  return duration(Math.floor(ms / 60_000));
}

const PLAN_STATUS = { done: 'done', running: 'running', ready: 'pending', blocked: 'blocked' } satisfies Record<Exclude<StepStatus, 'dropped'>, PlanItem['status']>;
