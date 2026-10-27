import type { Assumption, ReportItem } from '../model.ts';

/** A report's decisions or assumptions as items: a plain string, from a report saved before items named their step, has none. */
export const reportItems = (items: readonly (string | ReportItem)[] = []) =>
  items.map((i): ReportItem => (typeof i === 'string' ? { text: i } : i));

/** The thread's ledger with a report's assumptions added as open, from `turn`; one that repeats an open one word for word isn't added again. */
export function withAssumptions(
  ledger: Assumption[] = [],
  items: readonly ReportItem[],
  turn: number,
): Assumption[] {
  const open = new Set(
    ledger.filter((a) => a.state === 'open').map((a) => a.text),
  );
  const added: Assumption[] = [];
  for (const { text } of items) {
    if (open.has(text)) continue;
    open.add(text);
    added.push({
      id: `a${ledger.length + added.length + 1}`,
      text,
      turn,
      state: 'open',
    });
  }
  return added.length ? [...ledger, ...added] : ledger;
}

/** What Change puts in the message box, for you to finish. */
export const changeDraft = (a: Pick<Assumption, 'text'>) =>
  `About "${a.text}": `;

/** Sending a message Change drafted marks its assumption changed; clicking Change alone doesn't, so a draft you clear leaves it open. */
export function changedBySend(
  ledger: Assumption[] | undefined,
  text: string,
): Assumption[] | undefined {
  if (!ledger?.some((a) => isChangedBy(a, text))) return ledger;
  return ledger.map((a) =>
    isChangedBy(a, text) ? { ...a, state: 'changed' } : a,
  );
}

const isChangedBy = (a: Assumption, text: string) =>
  a.state === 'open' && text.startsWith(changeDraft(a));

/** Assumptions still waiting on your Accept or Change, from any turn. */
export const openAssumptions = (ledger: Assumption[] = []) =>
  ledger.filter((a) => a.state === 'open');
