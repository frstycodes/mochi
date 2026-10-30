import type { McpServer, Thread } from './model.ts';
import type { ThreadSummary } from './summary.ts';
import { activeTasks } from './runtime/tasks.ts';
import { plural } from '@mochi/domain/lib/format';

export type SummaryCardId =
  | 'environment'
  | 'threads'
  | 'sources'
  | 'connectors'
  | 'servers'
  | 'outputs'
  | 'changes'
  | 'tasks';

/** The cards with something to show, in Claude's order: where it runs and what it's tied to, what it holds, what it reaches, what it made, then what still runs. */
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
    'environment',
    linkedThreadCount > 0 && 'threads',
    'sources',
    !!thread.agent?.mcpServers?.length && 'connectors',
    portCount > 0 && 'servers',
    outputCount > 0 && 'outputs',
    (!!thread.repo || summary.files.length > 0 || thread.prs.length > 0) &&
      'changes',
    activeTasks(thread).length > 0 && 'tasks',
  ];
  return cards.filter((c) => c !== false);
}

/** The connectors' state in a few words: what needs you first, else how many are up. */
export function connectorStatus(servers: Pick<McpServer, 'status'>[]) {
  const broken = servers.filter(
    (s) => s.status === 'needs-auth' || s.status === 'failed',
  ).length;
  if (broken) return { text: `${broken} to reconnect`, needsYou: true };
  const connected = servers.filter((s) => s.status === 'connected').length;
  if (connected === servers.length)
    return { text: `${connected} connected`, needsYou: false };
  const pending = servers.filter((s) => s.status === 'pending').length;
  if (pending) return { text: `${pending} connecting`, needsYou: false };
  return { text: `${connected} of ${servers.length} on`, needsYou: false };
}

/** The thread's connectors, the ones this thread called first, most called first; `calls` is 0 for the rest. */
export function connectorUsage(
  servers: McpServer[],
  used: ThreadSummary['servers'],
) {
  return servers
    .map((server) => ({
      server,
      calls: used.find((u) => u.server === server.name)?.calls ?? 0,
    }))
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
