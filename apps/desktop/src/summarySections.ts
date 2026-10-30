import type { McpServer, Thread } from './model.ts';
import type { ThreadSummary } from './summary.ts';
import { activeTasks } from './runtime/tasks.ts';
import { plural } from '@mochi/domain/lib/format';

export type SummaryCardId = 'running' | 'changes' | 'threads' | 'sources';

/** The cards with something to show, most glanced-at first: what runs now, what it made, what it's tied to, then what it used. */
export function summaryCards({
  thread,
  summary,
  linkedThreadCount,
  portCount,
  outputCount,
}: {
  thread: Thread;
  summary: ThreadSummary;
  linkedThreadCount: number;
  portCount: number;
  outputCount: number;
}): SummaryCardId[] {
  const cards: (SummaryCardId | false)[] = [
    (activeTasks(thread).length > 0 || portCount > 0) && 'running',
    (!!thread.repo ||
      summary.files.length > 0 ||
      thread.prs.length > 0 ||
      outputCount > 0) &&
      'changes',
    linkedThreadCount > 0 && 'threads',
    'sources',
  ];
  return cards.filter((c) => c !== false);
}

/** Connectors that can't be reached until you sign in again or fix them. */
export const brokenConnectors = (servers: McpServer[]) =>
  servers.filter((s) => s.status === 'needs-auth' || s.status === 'failed');

/** The connectors this thread called, most called first. */
export function connectorUsage(
  servers: McpServer[],
  used: ThreadSummary['servers'],
) {
  return servers
    .map((server) => ({
      server,
      calls: used.find((u) => u.server === server.name)?.calls ?? 0,
    }))
    .filter((row) => row.calls > 0)
    .toSorted((a, b) => b.calls - a.calls);
}

export const fileCount = (n: number) => `${n} ${plural(n, 'file', 'files')}`;

/** `cards` in the order you dragged them to; a card you never placed keeps its default slot among them. */
export function orderCards(
  cards: SummaryCardId[],
  saved: readonly string[],
): SummaryCardId[] {
  const placed = saved.filter((id): id is SummaryCardId =>
    (cards as string[]).includes(id),
  );
  const out = [...placed];
  cards.forEach(
    (id, i) =>
      !placed.includes(id) && out.splice(Math.min(i, out.length), 0, id),
  );
  return out;
}

/** The saved order after a drag: the shown cards as dropped, then the hidden ones where they were. */
export function savedOrder(shown: SummaryCardId[], saved: readonly string[]) {
  return [...shown, ...saved.filter((id) => !(shown as string[]).includes(id))];
}
