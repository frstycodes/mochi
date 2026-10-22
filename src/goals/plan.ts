import type { Step, StepStatus } from '../model.ts';
export { planDuration } from '../progress.ts';

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

const PLAN_STATUS = { done: 'done', running: 'running', ready: 'pending', blocked: 'pending' } satisfies Record<Exclude<StepStatus, 'dropped'>, PlanItem['status']>;
