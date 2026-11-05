import { MAX_PLAN_STEPS } from '@mochi/domain/runtime/toolTable';
import type { AgentPlanItem } from '../host/types/agent.ts';
import type { Step } from '../model.ts';

export interface PlanArgs {
  items?: { title: string; status: keyof typeof PLAN_STATUS }[];
  scope?: string;
  advance?: boolean;
  done?: number[];
  start?: number;
}

/**
 * The plan an update_plan call leaves, from the thread's current one: `items` replace it, `advance`/`done`/`start` move through
 * it. A call that can't apply changes nothing and says how to fix it, in Claude Desktop's words; one that applies but looks
 * wrong (two steps in progress, moves sent with items) goes through with a warning.
 */
export function planUpdate(
  current: Step[],
  args: PlanArgs,
): { items: AgentPlanItem[]; warnings: string[] } | { error: string } {
  const isMove =
    !!args.advance || !!args.done?.length || args.start !== undefined;
  if (args.items) return replaced(args, isMove);
  if (!isMove)
    return nothing(
      'pass {"scope": "...", "items": [...]} for a new plan, or {"advance": true}, {"done": [n]} or {"start": n} to move through the current one.',
    );
  const plan = current.flatMap((s): AgentPlanItem[] =>
    s.status === 'dropped'
      ? []
      : [
          {
            title: s.title,
            status:
              s.status === 'ready'
                ? 'pending'
                : s.status === 'blocked'
                  ? 'running'
                  : s.status,
          },
        ],
  );
  if (!plan.length)
    return nothing(
      'there is no plan yet. Send {"scope": "first_task", "items": [...]} first.',
    );
  const bad = [
    ...(args.done ?? []),
    ...(args.start === undefined ? [] : [args.start]),
  ].find((n) => n < 1 || n > plan.length);
  if (bad !== undefined)
    return nothing(
      `there is no step ${bad}; the plan has ${plan.length} ${plan.length === 1 ? 'step' : 'steps'} (1-${plan.length}).`,
    );
  for (const n of args.done ?? []) plan[n - 1].status = 'done';
  if (args.start !== undefined) start(plan, args.start - 1);
  else if (args.advance) advance(plan);
  return { items: plan, warnings: runningWarning(plan) };
}

function replaced(
  args: PlanArgs,
  isMove: boolean,
): { items: AgentPlanItem[]; warnings: string[] } | { error: string } {
  const items = args.items!;
  if (!args.scope)
    return nothing(
      '"scope" is required with items. Add "scope": "first_task", "continuation" or "new_task".',
    );
  if (!items.length)
    return nothing('items is empty. Send the whole plan, at least one step.');
  if (items.length > MAX_PLAN_STEPS)
    return nothing(
      `the plan has ${items.length} steps; the limit is ${MAX_PLAN_STEPS}. Merge steps until it fits.`,
    );
  const empty = items.findIndex((i) => !i.title.trim());
  if (empty >= 0)
    return nothing(
      `step ${empty + 1} has no text. Give every step a short title.`,
    );
  const plan = items.map((i): AgentPlanItem => ({
    title: i.title.trim(),
    status: PLAN_STATUS[i.status],
  }));
  return {
    items: plan,
    warnings: [
      ...(isMove
        ? [
            'advance, done and start are ignored with items: the list you sent is the plan.',
          ]
        : []),
      ...runningWarning(plan),
    ],
  };
}

/** The running step done, then the next pending one started: after it, else the first. Nothing running starts the first pending. */
function advance(plan: AgentPlanItem[]) {
  const running = plan.findIndex((i) => i.status === 'running');
  if (running >= 0) plan[running].status = 'done';
  const after = plan.findIndex((i, k) => k > running && i.status === 'pending');
  const next =
    after >= 0 ? after : plan.findIndex((i) => i.status === 'pending');
  if (next >= 0) plan[next].status = 'running';
}

/** `start` puts one step in progress; one already running that wasn't said done goes back to pending. */
function start(plan: AgentPlanItem[], k: number) {
  for (const i of plan) if (i.status === 'running') i.status = 'pending';
  plan[k].status = 'running';
}

function runningWarning(plan: AgentPlanItem[]) {
  const running = plan.filter((i) => i.status === 'running').length;
  return running > 1
    ? [`${running} steps are in progress; keep exactly one in progress.`]
    : [];
}

const nothing = (fix: string) => ({ error: `Nothing changed: ${fix}` });

/** The plan as the agent left it, so it never has to count its own advances. */
export function planResult(items: AgentPlanItem[], warnings: string[] = []) {
  const running = items.findIndex((i) => i.status === 'running');
  const done = items.filter((i) => i.status === 'done').length;
  const head =
    running >= 0
      ? `Plan updated: step ${running + 1} of ${items.length} is in progress: "${items[running].title}".`
      : done === items.length
        ? 'Plan updated: every step is done.'
        : `Plan updated: no step is in progress; ${done} of ${items.length} done.`;
  return [head, ...warnings.map((w) => `Warning: ${w}`)].join(' ');
}

/** The plan with its running step done, as wrap_up leaves it; null when no step runs. */
export function closedRunning(steps: Step[]): AgentPlanItem[] | null {
  const plan = steps.filter((s) => s.status !== 'dropped');
  if (!plan.some((s) => s.status === 'running')) return null;
  return plan.map((s) => ({
    title: s.title,
    status:
      s.status === 'running' || s.status === 'done'
        ? 'done'
        : s.status === 'blocked'
          ? 'running'
          : 'pending',
  }));
}

const PLAN_STATUS = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'done',
} as const;
