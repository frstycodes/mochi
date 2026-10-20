import type { Step, StepStatus } from '../model.ts';
import { duration, formatElapsed } from '../progress.ts';

export interface PlanItem {
  title: string;
  status: 'done' | 'running' | 'pending';
  /** From start to done, or to now while it runs; none until it starts. */
  ms?: number;
}

/** The agent's plan as the chat's to-do list; dropped items leave it. `now` is Mochi's minute clock, `nowMs` the wall clock. */
export function planItems(steps: Step[], now: number, nowMs: number): PlanItem[] {
  return steps.flatMap((s) => {
    if (s.status === 'dropped') return [];
    const ms = stepElapsedMs(s, now, nowMs);
    return [{ title: s.title, status: PLAN_STATUS[s.status], ...(ms !== undefined && { ms }) }];
  });
}

/** Wall-clock ms for a step the agent stamped; a demo step, or one finished by an action without `ms`, has only Mochi's minute clock. */
export function stepElapsedMs(step: Step, now: number, nowMs: number) {
  const { startedMs, doneAt, doneMs } = step;
  if (startedMs !== undefined && (doneAt === undefined || doneMs !== undefined)) return Math.max(0, (doneMs ?? nowMs) - startedMs);
  if (step.startedAt !== undefined) return ((step.doneAt ?? now) - step.startedAt) * 60_000;
}

/** "42s", then "1m 05s" while it runs (seconds tick) and "12m" once done, then "1h 3m". */
export function planDuration(ms: number, isRunning: boolean) {
  if (isRunning || ms < 60_000) return formatElapsed(ms);
  return duration(Math.floor(ms / 60_000));
}

const PLAN_STATUS = { done: 'done', running: 'running', ready: 'pending', blocked: 'pending' } satisfies Record<Exclude<StepStatus, 'dropped'>, PlanItem['status']>;
