import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, ClipboardTick, History, Pause, Radio, TransferH } from 'reicon-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ActivityEntry, Step, StepStatus, Thread } from './model';
import { BurnUp, timeScale, type TimeScale } from './BurnUp';
import { revisionDiff } from './goals/edit';
import { clock, duration, minutesLeft, progressAt, statusAt, type Progress } from './progress';
import { checkpointAt, checkpointPhrase, rewindBlockedReason } from './rewind/checkpoints';
import { PROVIDER_NAME, stepOwner } from './rewind/handoff';
import { openRewind } from './rewind/requests';
import { useHarness } from './store';
import { ForkIcon, ProviderMark, SizeBadge, StepStatusIcon, TooltipIconButton, lineColor, stepColor, stepLabel } from './ui';

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
      </dl>
      <RevisionHistory thread={thread} />
      <div className="flex flex-wrap items-center gap-3 type-caption text-subtle-foreground">
        <LegendSwatch color={lineColor(thread.line)} label="Done" filled />
        <LegendSwatch color="var(--muted-foreground)" label="Scope" />
        {scrubAt !== null && (
          <Button variant="outline" size="xs" onClick={onLive}>
            <Radio data-icon="inline-start" />
            Back to live
          </Button>
        )}
        {scrubAt !== null && <RewindHere thread={thread} at={scrubAt} />}
      </div>
    </div>
  );
}

/** The scrubbed moment snaps back to the step boundary at or before it. */
function RewindHere({ thread, at }: { thread: Thread; at: number }) {
  const { state } = useHarness();
  const checkpoint = checkpointAt(state.checkpoints[thread.id] ?? [], at);
  if (!checkpoint) return null;
  const reason = rewindBlockedReason(thread);
  const button = (
    <Button variant="outline" size="xs" disabled={!!reason} onClick={() => openRewind({ kind: 'rewind', threadId: thread.id, n: checkpoint.n })}>
      <History data-icon="inline-start" />
      Rewind to here
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{reason ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
      <TooltipContent>{reason ?? `Rewind to ${checkpointPhrase(checkpoint)} at ${clock(checkpoint.at)}`}</TooltipContent>
    </Tooltip>
  );
}

function RevisionHistory({ thread }: { thread: Thread }) {
  return (
    <section aria-label="Goal history" className="flex flex-col gap-0.5">
      <h3 className="type-meta text-subtle-foreground">History</h3>
      <ol className="flex flex-col">
        {[...thread.revisions].reverse().map((r) => (
          <li key={r.n}>
            <RevisionRow thread={thread} n={r.n} label={r.label} at={r.at} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function RevisionRow({ thread, n, label, at }: { thread: Thread; n: number; label: string; at: number }) {
  const diff = revisionDiff(thread, n);
  return (
    <Collapsible className="group/rev">
      <CollapsibleTrigger disabled={diff.length === 0} className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left type-meta hover:bg-accent/60 disabled:hover:bg-transparent">
        <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-subtle-foreground transition-transform duration-150 group-data-[state=open]/rev:rotate-90', diff.length === 0 && 'invisible')} />
        <Badge variant="outline">v{n}</Badge>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="tabular type-caption text-subtle-foreground">{clock(at)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul aria-label={n > 1 ? `Changes from v${n - 1} to v${n}` : 'First plan'} className="flex flex-col gap-0.5 py-1 pl-6.5 type-caption">
          {diff.map((line, i) => (
            <li key={i} className="flex min-w-0 gap-1.5">
              <span aria-hidden className={cn('w-2 shrink-0 font-mono', DIFF_TONE[line[0] as DiffMark] ?? 'text-subtle-foreground')}>
                {line[0]}
              </span>
              <span className="min-w-0 text-muted-foreground text-pretty">{line.slice(2)}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

type DiffMark = '+' | '−' | '~';
const DIFF_TONE = { '+': 'text-success', '−': 'text-destructive', '~': 'text-subtle-foreground' } satisfies Record<DiffMark, string>;

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
              className="group/step relative grid grid-cols-1 items-center gap-x-6 py-2 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]"
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
          {thread.providers.length > 1 && <ProviderMark provider={stepOwner(thread, step)} size={12} className="shrink-0" />}
          {step.gate && status !== 'done' && (
            <Badge variant="outline" title="Pauses for your approval before it starts">
              <Pause data-icon="inline-start" />
              Pause before
            </Badge>
          )}
          <StepActions thread={thread} step={step} status={status} />
        </div>
        {step.acceptance && <AcceptanceLine acceptance={step.acceptance} />}
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

/** Rewind or fork at a finished step's checkpoint; hand an open step to the other agent. Shown on row hover or focus. */
function StepActions({ thread, step, status }: { thread: Thread; step: Step; status: StepStatus }) {
  const { state } = useHarness();
  const checkpoint = state.checkpoints[thread.id]?.findLast((c) => c.stepId === step.id);
  const isOpen = step.status !== 'done' && step.status !== 'dropped';
  const other = stepOwner(thread, step) === 'claude' ? 'codex' : 'claude';
  const canRewind = status === 'done' && !!checkpoint;
  if (!canRewind && !isOpen) return null;
  return (
    // Overlaid on the row's right edge so the hidden buttons take no width from the step title.
    <span className="absolute top-1.5 right-0 z-10 flex items-center rounded-md bg-popover opacity-0 shadow-popover transition-opacity duration-150 group-hover/step:opacity-100 group-focus-within/step:opacity-100 pointer-coarse:opacity-100">
      {canRewind && (
        <>
          <StepAction label={`Rewind to after "${step.title}"`} disabledReason={rewindBlockedReason(thread)} onClick={() => openRewind({ kind: 'rewind', threadId: thread.id, n: checkpoint.n })}>
            <History />
          </StepAction>
          <StepAction label={`Fork from after "${step.title}"`} onClick={() => openRewind({ kind: 'fork', threadId: thread.id, point: { kind: 'checkpoint', n: checkpoint.n } })}>
            <ForkIcon />
          </StepAction>
        </>
      )}
      {isOpen && (
        <StepAction label={`Hand "${step.title}" to ${PROVIDER_NAME[other]}`} onClick={() => openRewind({ kind: 'handoff', threadId: thread.id, stepId: step.id })}>
          <TransferH />
        </StepAction>
      )}
    </span>
  );
}

function StepAction({ label, disabledReason, onClick, children }: { label: string; disabledReason?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <TooltipIconButton label={label} hint={disabledReason} disabled={!!disabledReason} size="icon-xs" className="relative z-10 text-muted-foreground" onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
}

function AcceptanceLine({ acceptance }: { acceptance: NonNullable<Step['acceptance']> }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground" title="Acceptance criteria">
      <ClipboardTick aria-label="Acceptance criteria" className="size-3.5 shrink-0" />
      {!!acceptance.text && <span className="min-w-0 truncate">{acceptance.text}</span>}
      {!!acceptance.command && <code className="min-w-0 truncate font-mono type-caption text-subtle-foreground">{acceptance.command}</code>}
    </span>
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
