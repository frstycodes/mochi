import type { Provider } from '../model.ts';
import type { UsageReport } from '../host/types/usage.ts';
import { daysBetween, localDay } from './days.ts';

export type RangeId = '7d' | '30d' | '90d' | 'all';

export const RANGES = {
  '7d': { label: '7 days', days: 7 },
  '30d': { label: '30 days', days: 30 },
  '90d': { label: '90 days', days: 90 },
  all: { label: 'All time', days: null },
} satisfies Record<RangeId, { label: string; days: number | null }>;

/** Longer ranges chart weeks: 90 one-pixel days read as noise in a mini chart. */
const WEEKLY_AFTER_DAYS = 45;

/** Local midnight `days - 1` days before `now`, so a range always includes today; null for all time. */
export function rangeStart(range: RangeId, now: number): number | null {
  const days = RANGES[range].days;
  if (days === null) return null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

export interface UsageScope {
  range: RangeId;
  now: number;
  /** Which project each session root and repo belongs to. */
  projectOf: Map<string, string>;
  target: UsageTarget;
}

/** The profile's projects, one of them, or every folder on this computer (what `ccusage` counts). */
export type UsageTarget = { kind: 'projects' } | { kind: 'project'; id: string } | { kind: 'everywhere' };

/** The project row for sessions outside every project, when the target is everywhere. */
export const OTHER_FOLDERS = 'other-folders';

export interface SeriesPoint {
  /** The day, or the Monday that starts the week. */
  key: string;
  cost: Record<Provider, number>;
  tokens: number;
  prsMerged: number;
  commits: number;
  added: number;
  removed: number;
}

const emptyPoint = (key: string): SeriesPoint => ({ key, cost: { claude: 0, codex: 0 }, tokens: 0, prsMerged: 0, commits: 0, added: 0, removed: 0 });

export function usageView(report: UsageReport, scope: UsageScope) {
  const { target } = scope;
  const inScope = (path: string) => (target.kind === 'everywhere' ? true : target.kind === 'projects' ? scope.projectOf.has(path) : scope.projectOf.get(path) === target.id);
  const tokens = report.tokens.filter((b) => inScope(b.root));
  const commits = report.commits.filter((c) => inScope(c.repo));
  const prs = report.prs.filter((p) => inScope(p.repo));
  const sessions = report.sessions.filter((s) => inScope(s.root));

  const start = rangeStart(scope.range, scope.now);
  const firstDay = start !== null ? localDay(start) : [...tokens.map((b) => b.day), ...commits.map((c) => localDay(c.at))].sort()[0] ?? localDay(scope.now);
  const days = daysBetween(firstDay, localDay(scope.now));
  const isWeekly = days.length > WEEKLY_AFTER_DAYS;
  const keyOf = (day: string) => (isWeekly ? weekOf(day) : day);
  const series = new Map(days.map((d) => [keyOf(d), emptyPoint(keyOf(d))]));
  const point = (day: string) => series.get(keyOf(day));

  const spend = { claude: 0, codex: 0, uncached: 0 };
  const byType = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const costByType = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Map<string, { model: string; harness: Provider; tokens: number; cost: number | null }>();
  const projects = new Map<string, ProjectRow>();
  const project = (path: string) => {
    const id = scope.projectOf.get(path) ?? OTHER_FOLDERS;
    const row = projects.get(id) ?? { projectId: id, cost: 0, tokens: 0, commits: 0, prsMerged: 0, added: 0 };
    projects.set(id, row);
    return row;
  };

  for (const b of tokens) {
    const parts = b.cost;
    const cost = parts ? parts.input + parts.output + parts.cacheRead + parts.cacheWrite : 0;
    const total = b.input + b.output + b.cacheRead + b.cacheWrite5m + b.cacheWrite1h;
    spend[b.harness] += cost;
    spend.uncached += b.uncached ?? 0;
    byType.input += b.input;
    byType.output += b.output;
    byType.cacheRead += b.cacheRead;
    byType.cacheWrite += b.cacheWrite5m + b.cacheWrite1h;
    if (parts) for (const k of Object.keys(costByType) as (keyof typeof costByType)[]) costByType[k] += parts[k];
    const m = models.get(b.model) ?? { model: b.model, harness: b.harness, tokens: 0, cost: parts ? 0 : null };
    m.tokens += total;
    if (m.cost !== null) m.cost += cost;
    models.set(b.model, m);
    const row = project(b.root);
    row.cost += cost;
    row.tokens += total;
    const p = point(b.day);
    if (!p) continue;
    p.cost[b.harness] += cost;
    p.tokens += total;
  }

  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const commitTotals = { count: 0, merges: 0, added: 0, removed: 0 };
  for (const c of commits) {
    if (c.isMerge) {
      commitTotals.merges++;
      continue;
    }
    const at = new Date(c.at);
    commitTotals.count++;
    commitTotals.added += c.added;
    commitTotals.removed += c.removed;
    heatmap[(at.getDay() + 6) % 7][at.getHours()]++;
    const row = project(c.repo);
    row.commits++;
    row.added += c.added;
    const p = point(localDay(c.at));
    if (!p) continue;
    p.commits++;
    p.added += c.added;
    p.removed += c.removed;
  }

  for (const pr of prs) {
    if (pr.mergedAt === null) continue;
    project(pr.repo).prsMerged++;
    const p = point(localDay(pr.mergedAt));
    if (p) p.prsMerged++;
  }

  const totalCost = spend.claude + spend.codex;
  const totalTokens = byType.input + byType.output + byType.cacheRead + byType.cacheWrite;
  return {
    isWeekly,
    series: [...series.values()],
    spend: { ...spend, total: totalCost },
    sessions: { claude: sessions.filter((s) => s.harness === 'claude').length, codex: sessions.filter((s) => s.harness === 'codex').length },
    tokens: { ...byType, total: totalTokens },
    costByType,
    prs: { opened: prs.length, merged: prs.filter((p) => p.mergedAt !== null).length, closed: prs.filter((p) => p.state === 'CLOSED').length },
    commits: commitTotals,
    heatmap,
    models: [...models.values()].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens),
    projects: [...projects.values()].sort((a, b) => b.cost - a.cost || b.commits - a.commits),
    unpriced: [...models.values()].filter((m) => m.cost === null).map((m) => m.model),
  };
}

export type UsageView = ReturnType<typeof usageView>;

export interface ProjectRow {
  projectId: string;
  cost: number;
  tokens: number;
  commits: number;
  prsMerged: number;
  added: number;
}

/** The Monday starting the week `day` is in. */
function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d.getTime());
}
