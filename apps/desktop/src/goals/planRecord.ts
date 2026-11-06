import type { Assumption, PlanRecord, ReportItem, Step } from '../model.ts';
import { stepOf } from './ledger.ts';

export type RecordItem =
  | { kind: 'decision'; text: string }
  | { kind: 'assumption'; assumption: Assumption };

export interface RecordStep {
  step: Step;
  /** 1-based, as the agent numbered it. */
  n: number;
  items: RecordItem[];
}

/**
 * A turn's plan record laid out: each step with the decisions and answered assumptions made on it, and those with no valid step
 * number under Not on a step (never the last step). Open assumptions are left out: the box asks about them.
 */
export function recordLayout(record: PlanRecord, ledger: Assumption[] = []) {
  const count = record.steps.length;
  const byId = new Map(ledger.map((a) => [a.id, a]));
  const items: { step?: number; item: RecordItem }[] = [
    ...record.decisions.map((d: ReportItem) => ({
      step: stepOf(d, count),
      item: { kind: 'decision' as const, text: d.text },
    })),
    ...record.assumptionIds.flatMap((id) => {
      const a = byId.get(id);
      return a && a.state !== 'open'
        ? [
            {
              step: a.step && a.step <= count ? a.step : undefined,
              item: { kind: 'assumption' as const, assumption: a },
            },
          ]
        : [];
    }),
  ];
  const steps = record.steps.map((step, k): RecordStep => ({
    step,
    n: k + 1,
    items: items.filter((i) => i.step === k + 1).map((i) => i.item),
  }));
  const unplaced = items.filter((i) => i.step === undefined).map((i) => i.item);
  return { steps, unplaced };
}

/** The record's folded line: "Plan · 3 of 4 done · 2 decisions · 1 answered"; empty when there is nothing to tell. */
export function recordTitle(layout: ReturnType<typeof recordLayout>): string {
  const all = [...layout.steps.flatMap((s) => s.items), ...layout.unplaced];
  const decisions = all.filter((i) => i.kind === 'decision').length;
  const answered = all.length - decisions;
  const total = layout.steps.length;
  const done = layout.steps.filter((s) => s.step.status === 'done').length;
  return [
    total ? `Plan · ${done} of ${total} done` : 'Turn',
    !!decisions && count(decisions, 'decision'),
    !!answered && `${answered} answered`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const PLURAL = new Intl.PluralRules('en');

export const count = (n: number, word: string) =>
  `${n} ${PLURAL.select(n) === 'one' ? word : `${word}s`}`;
