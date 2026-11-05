import type { Assumption, ReportItem, Step } from '../model.ts';

/** A report's decisions or assumptions as items: a plain string, from a report saved before items named their step, has none. */
export const reportItems = (items: readonly (string | ReportItem)[] = []) =>
  items.map((i): ReportItem => (typeof i === 'string' ? { text: i } : i));

/** The item's step in a plan of `count` steps: its 1-based number, or none when it named no step, a title or one past the plan. */
export function stepOf({ step }: ReportItem, count: number) {
  return typeof step === 'number' && step >= 1 && step <= count
    ? step
    : undefined;
}

/**
 * The thread's ledger with a report's assumptions added as open, from `turn`, each on its step of `steps` (the turn's plan); one
 * that repeats an open one word for word isn't added again.
 */
export function withAssumptions(
  ledger: Assumption[] = [],
  items: readonly ReportItem[],
  turn: number,
  steps: Step[] = [],
): Assumption[] {
  const open = new Set(
    ledger.filter((a) => a.state === 'open').map((a) => a.text),
  );
  const added: Assumption[] = [];
  for (const item of items) {
    if (open.has(item.text)) continue;
    open.add(item.text);
    const step = stepOf(item, steps.length);
    added.push({
      id: `a${ledger.length + added.length + 1}`,
      text: item.text,
      turn,
      state: 'open',
      ...(step && { step, stepTitle: steps[step - 1].title }),
    });
  }
  return added.length ? [...ledger, ...added] : ledger;
}

/** Your rewording of an assumption, kept until your next message carries it; none, or the same words, puts it back to open. */
export function corrected(
  ledger: Assumption[] | undefined,
  id: string,
  correction: string | undefined,
): Assumption[] | undefined {
  return ledger?.map((a) => {
    if (a.id !== id) return a;
    const { correction: _, isSent: __, ...rest } = a;
    const text = correction?.trim();
    return text && text !== a.text
      ? { ...rest, state: 'changed', correction: text }
      : { ...rest, state: 'open' };
  });
}

/** Corrections your next message hasn't carried yet. */
export const pendingCorrections = (ledger: Assumption[] = []) =>
  ledger.filter((a) => a.state === 'changed' && !!a.correction && !a.isSent);

/** Your message with the corrections it carries at the top, as the agent reads them; unchanged without any. */
export function withCorrections(
  ledger: Assumption[] | undefined,
  text: string,
) {
  const pending = pendingCorrections(ledger);
  if (!pending.length) return text;
  // A list, so your message's markdown keeps one correction per line.
  const lines = pending.map(
    (a) =>
      `- ${a.step ? `Step ${a.step}: ` : ''}${a.correction} (not: ${a.text})`,
  );
  return `Corrections to your assumptions\n\n${lines.join('\n')}\n\n${text}`;
}

/**
 * Your message moved on from turn `turn`'s box: its corrections went with it, and its assumptions you left as they were count as
 * accepted. Older open ones stay open.
 */
export function answeredBySend(
  ledger: Assumption[] | undefined,
  turn: number | undefined,
): Assumption[] | undefined {
  if (!ledger?.length) return ledger;
  return ledger.map((a) => {
    if (a.state === 'changed' && a.correction && !a.isSent)
      return { ...a, isSent: true };
    if (a.state === 'open' && turn !== undefined && a.turn === turn)
      return { ...a, state: 'accepted' };
    return a;
  });
}

/** Assumptions still waiting on you, from any turn. */
export const openAssumptions = (ledger: Assumption[] = []) =>
  ledger.filter((a) => a.state === 'open');
