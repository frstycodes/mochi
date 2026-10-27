import { forwardRef } from 'react';
import { CommitHeatmap, SpendTrend, TokenCostFlow } from './charts';
import { Figure } from './Figure';
import {
  cacheNote,
  CachingCompare,
  Section,
  SpendSplit,
  StatStrip,
} from './parts';
import type { UsageView } from './report';
import { MochiMark } from '../ui';

/** The social image's size in CSS pixels; exported at 2×. */
export const CARD = { width: 1200, height: 675 };

/**
 * The shareable picture of a usage view: no title, just the numbers, the spend column on the sidebar surface and the stats
 * on the page background. Drawn at a fixed size in the app's current theme.
 */
export const ShareCard = forwardRef<
  HTMLDivElement,
  { view: UsageView; period: string; projectName: string | null }
>(function ShareCard({ view, period, projectName }, ref) {
  return (
    <div
      ref={ref}
      className="grid grid-cols-[400px_minmax(0,1fr)] bg-background text-foreground"
      style={CARD}
    >
      <section className="flex min-h-0 flex-col gap-5 bg-sidebar py-10 pr-9 pl-10 shadow-[inset_-1px_0_0_var(--color-sidebar-border)]">
        <p className="type-prose flex items-center gap-2.5 text-muted-foreground">
          <MochiMark className="h-[18px]" />
          <span className="truncate">
            <b className="font-medium text-foreground">{period}</b>
            {!!projectName && ` · ${projectName}`}
          </span>
        </p>
        <div>
          <p className="type-prose text-muted-foreground">
            API-equivalent spend
          </p>
          <Figure
            value={view.spend.total}
            kind="usd"
            className="text-[84px] leading-[88px] font-extrabold tracking-[-0.045em]"
          />
        </div>
        <SpendSplit view={view} />
        <CachingCompare view={view} />
        <Section title="Running total" className="min-h-0 flex-1 gap-2">
          <SpendTrend
            series={view.series}
            isWeekly={view.isWeekly}
            className="min-h-0 flex-1"
          />
        </Section>
      </section>

      <section className="flex min-h-0 min-w-0 flex-col gap-6 py-10 pr-12 pl-11">
        <StatStrip view={view} className="grid-cols-4" />
        <Section
          title="When the commits landed"
          note="Local time, one square per hour"
          className="gap-3"
        >
          <CommitHeatmap heatmap={view.heatmap} />
        </Section>
        <Section
          title="Tokens, and what they cost"
          note={cacheNote(view)}
          className="gap-3"
        >
          <TokenCostFlow tokens={view.tokens} costByType={view.costByType} />
        </Section>
      </section>
    </div>
  );
});
