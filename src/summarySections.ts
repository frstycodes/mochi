import type { Space, Thread } from './model.ts';
import type { ThreadSummary } from './summary.ts';
import { spaceUsage, threadUsage, type Usage } from './usage/model.ts';

export type SummarySectionId = 'outcome' | 'sources' | 'skills' | 'tools' | 'session' | 'usage' | 'space';

/** A section of the summary: `title`, then a count when the body is a list. */
export interface SummarySection {
  id: SummarySectionId;
  title: string;
  detail?: string;
}

export const TOKENS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const USD = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });

/** The sections with something to show, most useful first; the session's setup sits last. */
export function summarySections({ thread, summary, threads, space }: { thread: Thread; summary: ThreadSummary; threads: Thread[]; space: Space }): SummarySection[] {
  const sections: (SummarySection | false)[] = [
    thread.status === 'settled' && { id: 'outcome', title: 'Outcome' },
    summary.skills.length > 0 && { id: 'skills', title: 'Skills used', detail: String(summary.skills.length) },
    summary.toolTotal > 0 && { id: 'tools', title: 'Tools called', detail: String(summary.toolTotal) },
    thread.sources.length > 0 && { id: 'sources', title: 'Sources', detail: String(thread.sources.length) },
    hasUsage(threadUsage(thread)) && { id: 'usage', title: 'Thread usage' },
    hasUsage(spaceUsage(threads, space)) && { id: 'space', title: `${space.name} usage` },
    !!thread.agent && !!thread.session && { id: 'session', title: 'Session' },
  ];
  return sections.filter((s) => s !== false);
}

function hasUsage(usage: Usage) {
  return usage.input + usage.output > 0 || usage.costUsd !== null;
}
