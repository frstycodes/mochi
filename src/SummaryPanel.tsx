import { useState, type CSSProperties, type ReactNode } from 'react';
import { Add, BranchDown, BranchUp, Code, Coins, Document, DollarCircle, Edit, Global, Link, Maximize, Note, Pin, PinOff, Setting, TriangleWarning, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { Context, ContextContent, ContextContentBody, ContextContentHeader, ContextInputUsage, ContextOutputUsage, ContextTrigger } from '@/components/ai-elements/context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { SPACES, type Source, type Step, type Thread } from './model';
import { GoalTimeline, StepLinkLine, etaLabel } from './GoalTimeline';
import { GoalEditor } from './goals/GoalEditor';
import { outcomeOf } from './goals/outcome';
import { burnSeries, duration, minutesLeft, progressAt } from './progress';
import { useHarness } from './store';
import { summarize, type ToolVerb } from './summary';
import { lineColor, OverflowIcon, ProviderMark, StepStatusIcon } from './ui';
import { planUsage, spaceUsage, threadUsage, type PlanUsage } from './usage/model';

const LIST_LIMIT = 3;

const TOOL_ICONS = { Read: Document, Edit: Edit, Write: Edit, Run: Code, Browser: Global } satisfies Record<ToolVerb, IconComponent>;
const TOOL_LABELS = { Read: 'Read files', Edit: 'Edited files', Write: 'Wrote files', Run: 'Ran commands', Browser: 'Used the browser' } satisfies Record<ToolVerb, string>;
const SOURCE_ICONS = { link: Link, mcp: Setting, file: Document } satisfies Record<Source['kind'], IconComponent>;

export function SummaryPanel({ thread, className }: { thread: Thread; className?: string }) {
  const summary = summarize(thread.activity);
  const notYet = () => toast('Not in the prototype yet', { description: 'This opens a tab in the side pane in the real app.' });

  return (
    <aside aria-label="Thread summary" className={cn('flex min-h-0 flex-col', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pt-2 pb-3">
          <PanelHeader thread={thread} />
          {thread.status === 'settled' && <OutcomeSection thread={thread} />}
          <GoalSection thread={thread} />
          <Separator className="mx-2 my-2 w-auto!" />
          <RateLimitWarning thread={thread} />
          <SummaryRow icon={Edit} label="Changes" onClick={notYet}>
            <span className="tabular type-caption">
              <span className="text-success">+{summary.added}</span> <span className="text-destructive">−{summary.removed}</span>
            </span>
          </SummaryRow>
          <ContextRow thread={thread} />

          <Section label="Pull requests" empty={thread.prs.length === 0 ? 'No PRs linked yet' : undefined}>
            {thread.prs.map((pr) => (
              <SummaryRow key={pr.number} icon={pr.state === 'merged' ? BranchDown : BranchUp} label={pr.title} onClick={notYet}>
                <span className="tabular type-caption text-subtle-foreground">#{pr.number}</span>
              </SummaryRow>
            ))}
          </Section>

          <Section
            label="Sources"
            action={
              <Button variant="ghost" size="icon-xs" aria-label="Add a source" onClick={notYet}>
                <Add />
              </Button>
            }
            empty={thread.sources.length === 0 ? 'No sources yet' : undefined}
          >
            <LimitedList items={thread.sources}>
              {(source) => <SummaryRow key={source.label} icon={SOURCE_ICONS[source.kind]} label={source.label} onClick={notYet} />}
            </LimitedList>
          </Section>

          <Section label="Skills used" empty={thread.skills.length === 0 ? 'No skills loaded' : undefined}>
            <LimitedList items={thread.skills}>
              {(skill) => (
                <SummaryRow key={skill.name} icon={Note} label={<span className="font-mono type-caption">{skill.name}</span>}>
                  <span className="tabular type-caption text-subtle-foreground">×{skill.uses}</span>
                </SummaryRow>
              )}
            </LimitedList>
          </Section>

          <Section label={`Tools called · ${summary.toolTotal}`} empty={summary.tools.length === 0 ? 'No tool calls yet' : undefined}>
            {summary.tools.map((t) => (
              <SummaryRow key={t.verb} icon={TOOL_ICONS[t.verb]} label={TOOL_LABELS[t.verb]}>
                <span className="tabular type-caption text-subtle-foreground">{t.count}</span>
              </SummaryRow>
            ))}
          </Section>

          <ThreadUsageSection thread={thread} />
          <SpaceUsageSection thread={thread} />
        </div>
      </ScrollArea>
    </aside>
  );
}

function PanelHeader({ thread }: { thread: Thread }) {
  const { repo } = thread;
  return (
    <div className="flex items-center gap-2 px-2 pb-1">
      <span className="min-w-0 flex-1 truncate type-meta text-muted-foreground">
        {thread.repo ? (
          <>
            {thread.repo.project}
            <span className="text-subtle-foreground"> · </span>
            <span className="font-mono type-caption">{thread.repo.branch}</span>
          </>
        ) : (
          'No project'
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Summary options">
            <OverflowIcon vertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {repo && <DropdownMenuItem onSelect={() => navigator.clipboard?.writeText(repo.branch).catch(() => undefined)}>Copy branch name</DropdownMenuItem>}
            {!!thread.repo && <DropdownMenuItem onSelect={() => toast('Not in the prototype yet')}>Open in editor</DropdownMenuItem>}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Section({ label, action, empty, children }: { label: string; action?: ReactNode; empty?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5 pt-2">
      <div className="flex h-6 items-center px-2">
        <h3 className="flex-1 type-caption text-subtle-foreground">{label}</h3>
        {action}
      </div>
      {empty ? <p className="px-2 py-1 type-caption text-subtle-foreground">{empty}</p> : children}
    </section>
  );
}

function SummaryRow({ icon: Icon, label, onClick, children }: { icon: IconComponent; label: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const content = (
    <>
      <ItemMedia>
        <Icon className="size-4 text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0 truncate font-normal">{label}</ItemTitle>
      </ItemContent>
      {!!children && <ItemActions>{children}</ItemActions>}
    </>
  );
  if (!onClick)
    return (
      <Item size="xs" className="gap-2.5 px-2 py-1">
        {content}
      </Item>
    );
  return (
    <Item asChild size="xs" className="gap-2.5 px-2 py-1 hover:bg-accent/60">
      <button type="button" onClick={onClick}>
        {content}
      </button>
    </Item>
  );
}

function LimitedList<T>({ items, children }: { items: T[]; children: (item: T) => ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const shown = isOpen ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      {shown.map(children)}
      {items.length > LIST_LIMIT && (
        <Button variant="ghost" size="xs" className="self-start text-subtle-foreground" onClick={() => setOpen((o) => !o)}>
          {isOpen ? 'Show less' : `View all ${items.length}`}
        </Button>
      )}
    </>
  );
}

function ContextRow({ thread }: { thread: Thread }) {
  const { used, max } = thread.context;
  return (
    <Context usedTokens={used} maxTokens={max} openDelay={200}>
      <ContextTrigger>
        <Item asChild size="xs" className="gap-2.5 px-2 py-1 hover:bg-accent/60">
          <button type="button">
            <ItemMedia>
              <Global className="size-4 text-muted-foreground" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal">Context</ItemTitle>
            </ItemContent>
            <ItemActions className="tabular type-caption text-subtle-foreground">{Math.round((used / max) * 100)}%</ItemActions>
          </button>
        </Item>
      </ContextTrigger>
      <ContextContent align="end" side="left">
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}

const TOKENS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const USD = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<PlanUsage['provider'], string>;

function ThreadUsageSection({ thread }: { thread: Thread }) {
  const usage = threadUsage(thread);
  return (
    <Section label="Thread usage">
      <SummaryRow icon={Coins} label="Tokens">
        <span className="tabular type-caption text-subtle-foreground">
          {TOKENS.format(usage.input)} in · {TOKENS.format(usage.output)} out
        </span>
      </SummaryRow>
      <SummaryRow icon={DollarCircle} label="Est. cost">
        <span className="tabular type-caption text-subtle-foreground">{USD.format(usage.costUsd)}</span>
      </SummaryRow>
    </Section>
  );
}

function RateLimitWarning({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const space = SPACES.find((s) => s.id === thread.spaceId)!;
  const provider = thread.providers[0];
  const plan = planUsage(state.threads.filter((t) => t.spaceId === space.id), provider, space.plans[provider], state.now);
  if (thread.status !== 'running' || !plan.isWarning) return null;

  const name = `${PROVIDER_NAMES[plan.provider]} ${plan.plan}`;
  return (
    <p role="status" className="flex items-start gap-2.5 px-2 py-1 type-caption text-warning">
      <TriangleWarning className="size-4 shrink-0" aria-hidden />
      {plan.remaining === 0 ? `${name} limit reached; this agent stalls until the window resets.` : `${name} limit in about ${duration(Math.max(1, Math.round(plan.minutesLeft ?? 0)))} at this pace.`}
    </p>
  );
}

function SpaceUsageSection({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const space = SPACES.find((s) => s.id === thread.spaceId)!;
  const usage = spaceUsage(state.threads, space, state.now);
  return (
    <Section label={`${space.name} usage`} action={<span className="tabular type-caption text-subtle-foreground">{USD.format(usage.costUsd)} est.</span>}>
      {usage.plans.map((p) => (
        <PlanRow key={p.provider} plan={p} />
      ))}
    </Section>
  );
}

function PlanRow({ plan }: { plan: PlanUsage }) {
  const share = Math.min(1, plan.used / plan.limit);
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex items-center gap-2.5 type-body">
        <ProviderMark provider={plan.provider} size={16} />
        <span className="min-w-0 flex-1 truncate">
          {PROVIDER_NAMES[plan.provider]} <span className="text-subtle-foreground">· {plan.plan}</span>
        </span>
        <span className={cn('tabular type-caption', plan.isWarning ? 'text-warning' : 'text-subtle-foreground')}>{TOKENS.format(plan.remaining)} left</span>
      </div>
      <Progress value={share * 100} style={{ '--progress-color': plan.isWarning ? 'var(--warning)' : 'var(--muted-foreground)' } as CSSProperties} aria-label={`${PROVIDER_NAMES[plan.provider]} ${plan.plan} plan used`} />
    </div>
  );
}

function GoalSection({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const [isOpen, setOpen] = useState(false);
  const [isPinned, setPinned] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const live = progressAt(thread, state.now, true);
  const eta = minutesLeft(thread, state.now);
  const latest = thread.revisions[thread.revisions.length - 1];
  const now = thread.steps.filter((s) => s.status === 'running' || s.status === 'blocked');
  const waiting = thread.steps.filter((s) => s.status === 'waiting');
  const next = thread.steps.filter((s) => s.status === 'ready').slice(0, 2);

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <section aria-label="Goal" className="relative isolate flex flex-col gap-3 rounded-lg px-2 py-2 hover:bg-accent/40">
          <div className="flex items-center gap-2">
            <h2 className="type-title">Goal</h2>
            <Badge variant="outline" title={latest.label}>
              v{latest.n}
            </Badge>
            <span className="flex-1" />
            {/* z-10 lifts it above the stretched open-timeline button. */}
            <Button variant="ghost" size="icon-xs" className="relative z-10" aria-label="Edit goal" onClick={() => setEditing(true)}>
              <Edit />
            </Button>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="after:absolute after:inset-0 after:rounded-lg" aria-label={isOpen ? 'Close the full timeline' : 'Open the full timeline'}>
                <Maximize />
              </Button>
            </PopoverTrigger>
          </div>
          <p className="line-clamp-2 type-meta text-muted-foreground">{thread.goal}</p>
          <div className="flex items-end justify-between gap-2">
            <span className="tabular type-display">{Math.round(live.pct * 100)}%</span>
            <span className="tabular pb-1 type-caption text-subtle-foreground">
              {Math.round(live.done + live.partial)} of {live.scope} pts · {etaLabel(eta).toLowerCase()}
            </span>
          </div>
          <Sparkline thread={thread} now={state.now} />
          {now.map((s) => (
            <div key={s.id} className="flex flex-col gap-1.5">
              <StepLine step={s} />
              {s.status === 'running' && <Progress value={s.progress * 100} style={{ '--progress-color': lineColor(thread.line) } as CSSProperties} aria-label={`${s.title} progress`} />}
              {s.status === 'blocked' && <span className="type-caption text-warning">{s.note ?? 'Needs you'}</span>}
            </div>
          ))}
          {waiting.map((s) => (
            <div key={s.id} className="flex flex-col gap-0.5">
              <StepLine step={s} />
              <StepLinkLine thread={thread} step={s} />
            </div>
          ))}
          {next.map((s) => (
            <StepLine key={s.id} step={s} />
          ))}
        </section>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        collisionPadding={16}
        onEscapeKeyDown={() => setPinned(false)}
        onInteractOutside={(e) => isPinned && e.preventDefault()}
        className="surface-float w-[min(780px,calc(100vw-420px))] max-h-[calc(100vh-32px)] gap-0 overflow-y-auto rounded-xl bg-float p-5 shadow-float"
      >
        <div className="mb-4 flex items-start gap-3">
          <p className="min-w-0 flex-1 type-body text-muted-foreground text-pretty">{thread.goal}</p>
          <Button variant="ghost" size="sm" onClick={() => setPinned((p) => !p)} aria-pressed={isPinned}>
            {isPinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}
            {isPinned ? 'Unpin' : 'Keep open'}
          </Button>
        </div>
        <GoalTimeline thread={thread} />
      </PopoverContent>
      {isEditing && <GoalEditor thread={thread} onClose={() => setEditing(false)} />}
    </Popover>
  );
}

function StepLine({ step }: { step: Step }) {
  return (
    <span className="flex min-w-0 items-center gap-2 type-meta">
      <span className="flex w-4 justify-center">
        <StepStatusIcon status={step.status} />
      </span>
      <span className="truncate">{step.title}</span>
    </span>
  );
}

function Sparkline({ thread, now }: { thread: Thread; now: number }) {
  const series = burnSeries(thread, now);
  const live = progressAt(thread, now, true);
  const span = Math.max(1, now - thread.startedAt);
  const max = Math.max(...series.map((p) => p.scope), live.scope, 1) * 1.1;
  const W = 268;
  const H = 36;
  const x = (t: number) => ((t - thread.startedAt) / span) * W;
  const y = (v: number) => H - (v / max) * H;
  const path = (key: 'scope' | 'done') => series.map((p, i) => (i === 0 ? `M${x(p.t)} ${y(p[key])}` : `H${x(p.t)} V${y(p[key])}`)).join(' ');
  const color = lineColor(thread.line);
  const endY = y(live.done + live.partial);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Scope and done over time">
      <path d={`${path('done')} H${W} V${endY} V${H} H0 Z`} fill={color} fillOpacity={0.14} />
      <path d={`${path('done')} H${W} V${endY}`} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={`${path('scope')} H${W}`} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function OutcomeSection({ thread }: { thread: Thread }) {
  const outcome = outcomeOf(thread);
  return (
    <section aria-label="Outcome" className="flex flex-col gap-1.5 rounded-lg px-2 py-2">
      <h2 className="type-title">Outcome</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-meta">
        <dt className="text-subtle-foreground">Time</dt>
        <dd className="tabular">{duration(outcome.minutes)} from start to settle</dd>
        <dt className="text-subtle-foreground">Steps</dt>
        <dd className="tabular">
          {outcome.done} done
          {outcome.dropped > 0 && `, ${outcome.dropped} dropped`}
          {outcome.open > 0 && `, ${outcome.open} left open`}
        </dd>
        <dt className="text-subtle-foreground">Goal</dt>
        <dd className="tabular">{outcome.revisions === 0 ? 'Unchanged since it was set' : `Revised to v${outcome.revisions + 1}`}</dd>
        <dt className="text-subtle-foreground">PRs</dt>
        <dd className="tabular">
          {outcome.merged.length + outcome.unmerged.length === 0
            ? 'None'
            : [...outcome.merged.map((p) => `#${p.number} merged`), ...outcome.unmerged.map((p) => `#${p.number} ${p.state}`)].join(', ')}
        </dd>
      </dl>
    </section>
  );
}
