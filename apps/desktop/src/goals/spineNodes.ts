import type { Assumption, Step, Thread, TurnReport } from '../model.ts';
import { reportItems } from './ledger.ts';
import { splitAssumptions } from './Assumptions';
import type { SpineItem, SpineNode } from './Spine';

/**
 * What the end-of-turn card shows of the turn's decisions and assumptions: its spine with older open assumptions not on it,
 * or rows when it had no plan; nothing with the turn spine off (Settings), so the card is as it was before.
 */
export function turnSection(
  thread: Thread,
  report: TurnReport | undefined,
  isSpineOn: boolean,
) {
  if (!isSpineOn || !report) return null;
  const { current, earlier } = splitAssumptions(thread);
  const nodes = spineNodes(thread, report);
  if (!nodes)
    return {
      kind: 'rows' as const,
      current,
      earlier,
      decisions: reportItems(report.decisions).map((d) => d.text),
    };
  const shown = spineAssumptionIds(nodes);
  return {
    kind: 'spine' as const,
    nodes,
    earlier: earlier.filter((a) => !shown.has(a.id)),
  };
}

/**
 * The turn's spine from the thread's plan: its steps, the turn's pivots where they happened, and the report's decisions and
 * assumptions on the step each names (by title; one naming no step, or one the plan lacks, goes on the last step). Null when
 * the turn had no plan of its own: no step it added, started or finished, and no pivot, so the card falls back to rows.
 */
export function spineNodes(
  thread: Thread,
  report: TurnReport,
): SpineNode[] | null {
  const steps = thread.steps.filter((s) => s.status !== 'dropped');
  const pivots = (thread.pivots ?? []).filter((p) => p.turn === report.turn);
  const since = turnStartAt(thread, report);
  if (
    !steps.length ||
    (!pivots.length && !steps.some((s) => isTouched(s, since)))
  )
    return null;
  const items: SpineItem[][] = steps.map(() => []);
  const place = (step: string | undefined, item: SpineItem) =>
    items[stepIndex(steps, step)].push(item);
  for (const d of reportItems(report.decisions))
    place(d.step, { kind: 'decision', text: d.text });
  for (const a of reportItems(report.assumptions)) {
    const entry = ledgerEntry(thread.assumptions, a.text, report.turn);
    if (entry) place(a.step, { kind: 'assumption', id: entry.id });
  }
  const nodes: SpineNode[] = [];
  const pivotsAt = (i: number) =>
    pivots
      .filter((p) => Math.min(Math.max(p.at, 0), steps.length) === i)
      .map((p): SpineNode => ({
        kind: 'pivot',
        why: p.why ?? 'No reason given',
        dropped: p.dropped,
      }));
  steps.forEach((s, i) => {
    nodes.push(...pivotsAt(i), {
      kind: 'step',
      title: s.title,
      status: s.status === 'done' ? 'done' : 'pending',
      ...(items[i].length && { items: items[i] }),
    });
  });
  nodes.push(...pivotsAt(steps.length));
  return nodes;
}

/** The ledger ids a spine shows, so Still open doesn't list them twice. */
const spineAssumptionIds = (nodes: SpineNode[]) =>
  new Set(
    nodes.flatMap((n) =>
      n.kind === 'step'
        ? (n.items ?? []).flatMap((i) =>
            i.kind === 'assumption' ? [i.id] : [],
          )
        : [],
    ),
  );

function stepIndex(steps: Step[], title: string | undefined) {
  const key = title?.trim().toLowerCase();
  const i = key ? steps.findIndex((s) => s.title.toLowerCase() === key) : -1;
  return i >= 0 ? i : steps.length - 1;
}

/** The ledger's entry for a reported assumption: this turn's, or the open one it repeated (`withAssumptions` adds no copy). */
function ledgerEntry(
  ledger: Assumption[] = [],
  text: string,
  turn: number | undefined,
) {
  const same = ledger.filter((a) => a.text === text);
  return (
    same.find((a) => a.turn === turn) ?? same.find((a) => a.state === 'open')
  );
}

/** When the report's turn began: your message before it, on Mochi's minute clock. */
function turnStartAt(thread: Thread, report: TurnReport) {
  const end = report.index ?? thread.activity.length;
  const start = thread.activity
    .slice(0, end)
    .findLast((e) => e.who === 'you' && e.kind === 'message');
  return start?.at ?? -Infinity;
}

const isTouched = (s: Step, since: number) =>
  [s.addedAt, s.startedAt, s.doneAt].some(
    (at) => at !== undefined && at >= since,
  );
