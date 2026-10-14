import { useSyncExternalStore } from 'react';
import { outcomeOf } from './goals/outcome.ts';
import type { Space, Thread } from './model.ts';
import { duration } from './progress.ts';
import type { ThreadSummary } from './summary.ts';
import { spaceUsage, threadUsage, type Usage } from './usage/model.ts';

export type SummarySectionId = 'outcome' | 'sources' | 'skills' | 'tools' | 'session' | 'usage' | 'space';
type AlwaysShownSectionId = 'skills' | 'tools';
export type CollapsibleSectionId = Exclude<SummarySectionId, AlwaysShownSectionId>;
const ALWAYS_SHOWN = new Set<SummarySectionId>(['skills', 'tools'] satisfies AlwaysShownSectionId[]);

/** A section of the summary: `title`, then `detail`, so a closed one still says something. */
export interface SummarySection {
  id: SummarySectionId;
  title: string;
  detail?: string;
}

export const TOKENS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const USD = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
const PLURAL = new Intl.PluralRules('en');

/** The sections with something to show, in reading order. */
export function summarySections({ thread, summary, threads, space }: { thread: Thread; summary: ThreadSummary; threads: Thread[]; space: Space }): SummarySection[] {
  const sections: (SummarySection | false)[] = [
    thread.status === 'settled' && outcomeSection(thread),
    thread.sources.length > 0 && { id: 'sources', title: 'Sources', detail: String(thread.sources.length) },
    summary.skills.length > 0 && { id: 'skills', title: 'Skills used', detail: String(summary.skills.length) },
    summary.toolTotal > 0 && { id: 'tools', title: 'Tools called', detail: String(summary.toolTotal) },
    !!thread.agent && !!thread.session && { id: 'session', title: 'Session', detail: thread.agent.model },
    usageSection('usage', 'Thread usage', threadUsage(thread)),
    usageSection('space', `${space.name} usage`, spaceUsage(threads, space)),
  ];
  return sections.filter((s) => s !== false);
}

function outcomeSection(thread: Thread): SummarySection {
  const outcome = outcomeOf(thread);
  return {
    id: 'outcome',
    title: 'Outcome',
    detail: `${duration(outcome.minutes)} · ${outcome.done} ${PLURAL.select(outcome.done) === 'one' ? 'step' : 'steps'} done`,
  };
}

function usageSection(id: SummarySectionId, title: string, usage: Usage): SummarySection | false {
  const tokens = usage.input + usage.output;
  if (tokens === 0 && usage.costUsd === null) return false;
  return { id, title, detail: [`${TOKENS.format(tokens)} tokens`, usage.costUsd !== null && USD.format(usage.costUsd)].filter(Boolean).join(' · ') };
}

export function isCollapsible(section: SummarySection): section is SummarySection & { id: CollapsibleSectionId } {
  return !ALWAYS_SHOWN.has(section.id);
}

/** Which collapsible sections start open: what you last chose for each, else Outcome on a settled thread. */
export function openSectionIds(sections: SummarySection[], remembered: Partial<Record<CollapsibleSectionId, boolean>>, isSettled: boolean) {
  return sections.filter(isCollapsible).filter((s) => remembered[s.id] ?? (s.id === 'outcome' && isSettled)).map((s) => s.id);
}

// Open state is remembered per section, not per thread, and shared by the docked column and the floating card.
const OPEN_KEY = 'mochi.summary.open.v1';
let remembered = loadOpen();
const listeners = new Set<() => void>();

function loadOpen(): Partial<Record<CollapsibleSectionId, boolean>> {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(OPEN_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function useRememberedOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => remembered,
  );
}

/** Records the open state of every collapsible section shown; sections not on screen keep what they had. */
export function rememberOpen(shown: SummarySection[], open: string[]) {
  remembered = { ...remembered, ...Object.fromEntries(shown.filter(isCollapsible).map((s) => [s.id, open.includes(s.id)])) };
  globalThis.localStorage?.setItem(OPEN_KEY, JSON.stringify(remembered));
  listeners.forEach((l) => l());
}
