import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Coin, Commit } from '@/icons';
import { GitMergeIcon } from '@/icons/github';
import { DiffIcon } from '@/icons/panes';
import { cn } from '@/lib/utils';
import type { Provider } from '../model';
import { HARNESSES } from '../settings/harnesses';
import { ProviderMark } from '../ui';
import { SparkBars, type TipContent } from './charts';
import { periodName } from './days';
import { compact, Figure, usd } from './Figure';
import type { UsageView } from './report';

/** Claude Code's and Codex's shares of the spend as one bar, then a row each with its sessions and dollars. */
export function SpendSplit({ view }: { view: UsageView }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2 gap-0.5">
        <i className="rounded-sm bg-chart-2" style={{ flex: view.spend.claude || 0.0001 }} />
        {view.spend.codex > 0 && <i className="rounded-sm bg-chart-1" style={{ flex: `0 0 max(4px, ${(view.spend.codex / view.spend.total) * 100}%)` }} />}
      </div>
      <HarnessRow provider="claude" sessions={view.sessions.claude} cost={view.spend.claude} />
      <HarnessRow provider="codex" sessions={view.sessions.codex} cost={view.spend.codex} />
    </div>
  );
}

function HarnessRow({ provider, sessions, cost }: { provider: Provider; sessions: number; cost: number }) {
  return (
    <div className="type-prose flex items-center gap-2 text-muted-foreground">
      <ProviderMark provider={provider} size={16} />
      <span className="min-w-0 flex-1 truncate">
        {HARNESSES[provider].name} · {sessions.toLocaleString('en-US')} {sessions === 1 ? 'session' : 'sessions'}
      </span>
      <span className="figure font-semibold text-foreground">{usd(cost, 2)}</span>
    </div>
  );
}

/** The same tokens priced with no prompt cache, against what they cost; nothing when caching saved nothing. */
export function CachingCompare({ view }: { view: UsageView }) {
  const saved = view.spend.uncached - view.spend.total;
  if (saved <= 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="type-prose flex justify-between text-muted-foreground">
        <span>Without prompt caching</span>
        <span className="figure font-semibold text-foreground">{usd(view.spend.uncached)}</span>
      </div>
      <div className="flex h-2 rounded-sm bg-foreground/14">
        <i className="rounded-sm bg-chart-2" style={{ width: `${(view.spend.total / view.spend.uncached) * 100}%` }} />
      </div>
      <p className="type-meta text-subtle-foreground">
        Caching made it {Math.round(view.spend.uncached / view.spend.total)}× cheaper, {usd(saved)} saved
      </p>
    </div>
  );
}

/** Tokens, PRs merged, commits and lines added: each a big figure over a mini chart of the range. */
export function StatStrip({ view, className }: { view: UsageView; className?: string }) {
  const merged = view.series.map((p) => p.prsMerged);
  const tip = (i: number, rows: TipContent['rows']) => ({ title: periodName(view.series[i].key, view.isWeekly), rows });
  return (
    <div className={cn('grid gap-x-8 gap-y-10', className)}>
      <Stat icon={Coin} color="var(--color-chart-2)" label="Tokens" sub={`${compact(view.tokens.output)} written by the model`}>
        <Figure value={view.tokens.total} kind="compact" className="text-[34px] leading-10 font-bold" />
        <SparkBars values={view.series.map((p) => p.tokens)} color="var(--color-chart-2)" describe={(i) => tip(i, [{ label: 'Tokens', value: compact(view.series[i].tokens) }, { label: 'Spend', value: usd(view.series[i].cost.claude + view.series[i].cost.codex, 2) }])} />
      </Stat>
      <Stat icon={GitMergeIcon} color="var(--color-merged)" label="PRs merged" sub={`${perActivePeriod(merged)} ${view.isWeekly ? 'a week' : 'a day'}, ${view.prs.closed} closed`}>
        <span className="figure text-[34px] leading-10 font-bold tracking-[-0.035em]">
          {view.prs.merged.toLocaleString('en-US')}
          <span className="type-prose ml-1 font-medium tracking-normal text-muted-foreground">/ {view.prs.opened.toLocaleString('en-US')}</span>
        </span>
        <SparkBars values={merged} color="var(--color-merged)" describe={(i) => tip(i, [{ label: 'Merged', value: merged[i].toLocaleString('en-US') }])} />
      </Stat>
      <Stat icon={Commit} color="var(--foreground)" label="Commits" sub={`plus ${view.commits.merges.toLocaleString('en-US')} merge commits`}>
        <Figure value={view.commits.count} kind="count" className="text-[34px] leading-10 font-bold" />
        <SparkBars values={view.series.map((p) => p.commits)} color="var(--foreground)" describe={(i) => tip(i, [{ label: 'Commits', value: view.series[i].commits.toLocaleString('en-US') }])} />
      </Stat>
      <Stat icon={DiffIcon} color="var(--color-success)" label="Lines added" sub={<><span className="text-destructive">−{compact(view.commits.removed)}</span> removed</>}>
        <Figure value={view.commits.added} kind="signed" className="text-[34px] leading-10 font-bold text-success" />
        <SparkBars
          values={view.series.map((p) => p.added)}
          below={view.series.map((p) => p.removed)}
          color="var(--color-success)"
          describe={(i) =>
            tip(i, [
              { label: 'Added', value: `+${view.series[i].added.toLocaleString('en-US')}`, color: 'var(--color-success)' },
              { label: 'Removed', value: `−${view.series[i].removed.toLocaleString('en-US')}`, color: 'var(--color-destructive)' },
            ])
          }
        />
      </Stat>
    </div>
  );
}

function Stat({ icon: Icon, color, label, sub, children }: { icon: ComponentType<{ className?: string; style?: CSSProperties }>; color: string; label: string; sub: ReactNode; children: [ReactNode, ReactNode] }) {
  const [figure, chart] = children;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="type-prose flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-4" style={{ color }} />
        {label}
      </span>
      {figure}
      <span className="type-meta truncate text-subtle-foreground">{sub}</span>
      <div className="mt-2.5">{chart}</div>
    </div>
  );
}

export function Section({ title, note, className, children }: { title: string; note?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className="flex items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="type-title shrink-0">{title}</h2>
        {!!note && <span className="type-meta truncate text-subtle-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** "Cache reads are 98.5% of the tokens but 59% of the spend": why caching matters, in one line. */
export function cacheNote(view: UsageView) {
  return `Cache reads are ${pct(view.tokens.cacheRead, view.tokens.total)} of the tokens but ${pct(view.costByType.cacheRead, view.spend.total)} of the spend`;
}

const pct = (part: number, whole: number) => `${whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0}%`;

function perActivePeriod(values: number[]) {
  const active = values.filter((v) => v > 0);
  return active.length ? Math.round(active.reduce((s, v) => s + v, 0) / active.length) : 0;
}
