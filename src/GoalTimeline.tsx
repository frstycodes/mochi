import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Radio } from 'reicon-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ActivityEntry, Step, StepStatus, Thread } from './model';
import { BurnUp, timeScale, type TimeScale } from './BurnUp';
import { clock, duration, minutesLeft, progressAt, statusAt, type Progress } from './progress';
import { useHarness } from './store';
import { ProviderMark, SizeBadge, StepStatusIcon, lineColor, stepColor, stepLabel } from './ui';

export function GoalTimeline({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>();
  const timeline = useTimeline(thread, state.now, plotWidth);
  const viewT = scrubAt ?? state.now;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Progress" className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <ProgressSummary thread={thread} live={timeline.live} eta={timeline.eta} scrubAt={scrubAt} onLive={() => setScrubAt(null)} />
        <div ref={plotRef} className="min-w-0">
          {plotWidth > 0 && <BurnUp thread={thread} now={state.now} scale={timeline.scale} live={timeline.live} projection={timeline.projection} scrubAt={scrubAt} onScrub={setScrubAt} />}
        </div>
      </section>
      <StepList thread={thread} viewT={viewT} isLive={scrubAt === null} scale={plotWidth > 0 ? timeline.scale : null} now={state.now} />
    </div>
  );
}

const PROJECTION_SHARE = 0.3;

export function useTimeline(thread: Thread, now: number, width: number) {
  const live = progressAt(thread, now, true);
  const eta = minutesLeft(thread, now);
  const span = Math.max(60, now - thread.startedAt);
  const ahead = eta === null ? 0 : Math.min(eta, Math.round(span * PROJECTION_SHARE));
  const remaining = live.scope - live.done - live.partial;
  const projection = eta ? { t: now + ahead, value: live.done + live.partial + (remaining * ahead) / eta } : null;
  const scale = timeScale(thread.startedAt, thread.startedAt + span + ahead, width);
  return { live, eta, projection, scale };
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function etaLabel(eta: number | null) {
  if (eta === null) return 'Measuring pace';
  if (eta === 0) return 'Done';
  return `About ${duration(eta)} left`;
}

function ProgressSummary({ thread, live, eta, scrubAt, onLive }: { thread: Thread; live: Progress; eta: number | null; scrubAt: number | null; onLive: () => void }) {
  const shown = scrubAt === null ? live : progressAt(thread, scrubAt, false);
  const added = thread.steps.filter((s) => s.revision > 1 && s.status !== 'dropped').reduce((n, s) => n + s.size, 0);
  const dropped = thread.steps.filter((s) => s.status === 'dropped').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2.5">
        <span className="tabular type-display">{Math.round(shown.pct * 100)}%</span>
        <span className="tabular pb-1 type-meta text-muted-foreground">
          {Math.round(shown.done + shown.partial)} of {shown.scope} pts
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-meta">
        <dt className="text-subtle-foreground">Pace</dt>
        <dd className="tabular">{etaLabel(eta)}</dd>
        <dt className="text-subtle-foreground">Scope</dt>
        <dd className="tabular">
          +{added} pts added{dropped > 0 && `, ${dropped} dropped`}
        </dd>
        <dt className="text-subtle-foreground">Revisions</dt>
        <dd>{thread.revisions.length > 1 ? thread.revisions.slice(1).map((r) => `v${r.n} ${r.label.toLowerCase()}`).join('; ') : 'None yet'}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-3 type-caption text-subtle-foreground">
        <LegendSwatch color={lineColor(thread.line)} label="Done" filled />
        <LegendSwatch color="var(--muted-foreground)" label="Scope" />
        {scrubAt !== null && (
          <Button variant="outline" size="xs" onClick={onLive}>
            <Radio data-icon="inline-start" />
            Back to live
          </Button>
        )}
      </div>
    </div>
  );
}

function LegendSwatch({ color, label, filled }: { color: string; label: string; filled?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="h-2.5 w-3 rounded-sm border-t-2" style={{ borderColor: color, background: filled ? `color-mix(in oklab, ${color} 18%, transparent)` : undefined }} />
      {label}
    </span>
  );
}

function StepList({ thread, viewT, isLive, scale, now }: { thread: Thread; viewT: number; isLive: boolean; scale: TimeScale | null; now: number }) {
  const rows = thread.steps
    .map((step) => ({ step, status: isLive ? step.status : statusAt(step, viewT) }))
    .filter((r): r is { step: Step; status: StepStatus } => r.status !== null);
  const current = thread.activity.findLast((a) => a.kind === 'tool');

  return (
    <section aria-label="Steps" className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pb-1.5">
        <h3 className="type-title">Steps</h3>
        <span className="type-meta text-subtle-foreground">{isLive ? 'Live' : `As planned at ${clock(viewT)}`}</span>
        <StepLegend statuses={rows.map((r) => r.status)} />
      </div>
      <ol className="flex flex-col">
        <AnimatePresence initial={false}>
          {rows.map(({ step, status }) => (
            <motion.li
              key={step.id}
              layout="position"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="grid grid-cols-1 items-center gap-x-6 py-2 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]"
            >
              <StepInfo thread={thread} step={step} status={status} liveTool={isLive && status === 'running' ? current : undefined} />
              {scale && <StepTrack thread={thread} step={step} status={status} scale={scale} viewT={isLive ? now : viewT} />}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

function StepLegend({ statuses }: { statuses: StepStatus[] }) {
  const shown = LEGEND_ORDER.filter((s) => statuses.includes(s));
  return (
    <ul className="ml-auto hidden flex-wrap items-center gap-3 type-caption text-muted-foreground md:flex">
      {shown.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-3 rounded-full" style={{ background: stepColor(status) }} />
          {stepLabel(status)}
        </li>
      ))}
    </ul>
  );
}

const LEGEND_ORDER: StepStatus[] = ['done', 'running', 'waiting', 'blocked', 'ready', 'dropped'];

function StepInfo({ thread, step, status, liveTool }: { thread: Thread; step: Step; status: StepStatus; liveTool?: ActivityEntry }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="flex h-5 w-4 items-center justify-center">
        <StepStatusIcon status={status} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('min-w-0 truncate', status === 'dropped' && 'text-subtle-foreground line-through')} title={`${step.title} (${stepLabel(status)})`}>
            {step.title}
          </span>
          <SizeBadge size={step.size} />
          {step.revision > 1 && <Badge variant="outline">v{step.revision}</Badge>}
        </div>
        <StepLinkLine thread={thread} step={step} />
        {!!step.note && !step.link && <span className="type-meta text-subtle-foreground">{step.note}</span>}
        {liveTool && (
          <span className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
            <ProviderMark provider={thread.providers[0]} size={12} />
            <span className="truncate font-mono type-caption">{liveTool.text}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function StepLinkLine({ thread, step }: { thread: Thread; step: Step }) {
  const { state, dispatch } = useHarness();
  if (!step.link) return null;
  const link = step.link;
  const ids = link.mode === 'provides-for' ? link.threadIds : [link.threadId];
  const others = ids.map((id) => state.threads.find((t) => t.id === id)).filter((t): t is Thread => !!t && t.id !== thread.id);
  const verb = { 'provided-by': 'From', 'provides-for': 'Also used by', race: 'Racing', related: 'Related to' } satisfies Record<typeof link.mode, string>;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 type-meta text-muted-foreground">
      {verb[link.mode]}
      {/* z-10 lifts it above the goal card's stretched open button. */}
      {others.map((o) => (
        <Button key={o.id} variant="ghost" size="xs" className="relative z-10 min-w-0" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: o.id } })}>
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(o.line) }} />
          <span className="truncate">{o.title}</span>
        </Button>
      ))}
    </span>
  );
}

function StepTrack({ thread, step, status, scale, viewT }: { thread: Thread; step: Step; status: StepStatus; scale: TimeScale; viewT: number }) {
  const color = stepColor(status);
  const x = scale.x;
  const start = step.startedAt !== undefined && step.startedAt <= viewT ? step.startedAt : undefined;
  const from = status === 'ready' ? viewT : status === 'waiting' ? step.addedAt : (start ?? step.addedAt);
  const to = status === 'done' ? step.doneAt! : status === 'dropped' ? (step.droppedAt ?? viewT) : viewT;
  const left = x(from);
  const width = Math.max(6, x(to) - left);
  // Labels sit right of the bar; near the plot's right edge they flip to its left.
  const flip = left + width + 96 > scale.width;

  return (
    <div className="relative -my-2 hidden self-stretch md:block" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'var(--chart-grid)' }} />
      <span className="absolute inset-y-0 w-px bg-foreground/15" style={{ left: x(viewT) }} />
      {step.addedAt > thread.startedAt && <span className="absolute top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border bg-background" style={{ left: x(step.addedAt), borderColor: color }} />}
      <span className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ left, width, ...barStyle(status, color) }} />
      <span className="tabular absolute top-1/2 -translate-y-1/2 whitespace-nowrap type-caption font-medium" style={{ color: `color-mix(in oklab, ${color} 70%, var(--foreground))`, ...(flip ? { right: scale.width - left + 6 } : { left: left + width + 6 }) }}>
        {trackLabel(status, from, to)}
      </span>
    </div>
  );
}

function barStyle(status: StepStatus, color: string) {
  if (status === 'blocked') return { background: `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)` };
  if (status === 'waiting' || status === 'ready') return { background: `color-mix(in oklab, ${color} 18%, transparent)`, border: `1px dashed ${color}` };
  if (status === 'dropped') return { background: color, height: 1, opacity: 0.6 };
  return { background: color };
}

function trackLabel(status: StepStatus, from: number, to: number) {
  const took = duration(Math.max(0, Math.round(to - from)));
  if (status === 'done') return `Done in ${took}`;
  if (status === 'running') return `Running ${took}`;
  if (status === 'waiting') return `Waiting ${took}`;
  if (status === 'blocked') return 'Needs you';
  if (status === 'dropped') return 'Dropped';
  return 'Up next';
}
