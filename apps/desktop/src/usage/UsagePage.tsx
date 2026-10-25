import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Refresh, Share } from '@/icons';
import { cn } from '@/lib/utils';
import type { Project } from '@mochi/domain/host/types/projects';
import { ProviderMark, TooltipIconButton } from '../ui';
import { periodName } from '@mochi/domain/usage/days';
import { CommitHeatmap, SpendTrend, TokenCostFlow } from './charts';
import { compact, Figure, usd } from './Figure';
import {
  cacheNote,
  CachingCompare,
  Section,
  SpendSplit,
  StatStrip,
} from './parts';
import {
  OTHER_FOLDERS,
  RANGES,
  type RangeId,
  type UsageTarget,
  type UsageView,
} from './report';
import { ShareDialog } from './ShareDialog';
import { useUsage } from './useUsage';

export function UsagePage() {
  const [range, setRange] = useState<RangeId>('30d');
  const [target, setTarget] = useState<UsageTarget>({ kind: 'projects' });
  const [isSharing, setIsSharing] = useState(false);
  const usage = useUsage(range, target);
  const project =
    target.kind === 'project'
      ? usage.projects.find((p) => p.id === target.id)
      : undefined;
  const reach = project
    ? project.name
    : target.kind === 'everywhere'
      ? 'everywhere on this computer'
      : "this profile's projects";
  const { view } = usage;
  const isEmpty =
    !!view &&
    view.tokens.total === 0 &&
    view.commits.count === 0 &&
    view.prs.opened === 0;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-4 pt-5 pb-16 md:px-8 md:pt-8">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="type-heading">Usage</h1>
            <p className="type-body text-muted-foreground">
              Claude Code and Codex across {reach}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={range} onValueChange={(v) => setRange(v as RangeId)}>
              <TabsList>
                {(Object.keys(RANGES) as RangeId[]).map((id) => (
                  <TabsTrigger key={id} value={id}>
                    {RANGES[id].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <TargetPicker
              projects={usage.projects}
              value={target}
              onChange={setTarget}
            />
            <TooltipIconButton
              label="Refresh"
              hint="Read the logs, commits and pull requests again"
              onClick={usage.refresh}
              disabled={usage.isLoading}
            >
              <Refresh
                className={cn(
                  usage.isLoading && 'animate-spin motion-reduce:animate-none',
                )}
              />
            </TooltipIconButton>
            <Button
              onClick={() => setIsSharing(true)}
              disabled={!view || isEmpty}
            >
              <Share data-icon="inline-start" />
              Share
            </Button>
          </div>
        </header>

        {!view && !usage.error && <UsageSkeleton />}
        {usage.error && (
          <UsageError message={usage.error} onRetry={usage.refresh} />
        )}
        {isEmpty && <NoUsage rangeLabel={RANGES[range].label} />}
        {view && !isEmpty && (
          <div
            className={cn(
              'flex flex-col gap-12 transition-opacity duration-200',
              usage.isLoading && 'opacity-60',
            )}
          >
            <SpendSection view={view} />
            <StatStrip
              view={view}
              className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            />
            <Section
              title="When the commits landed"
              note="Your commits on the default branch, by weekday and local hour"
            >
              <CommitHeatmap heatmap={view.heatmap} />
            </Section>
            <Section title="Tokens, and what they cost" note={cacheNote(view)}>
              <TokenCostFlow
                tokens={view.tokens}
                costByType={view.costByType}
              />
            </Section>
            <ModelsTable models={view.models} />
            {target.kind !== 'project' && view.projects.length > 1 && (
              <ProjectsTable rows={view.projects} projects={usage.projects} />
            )}
            <PeriodTable view={view} />
            <Footnote unpriced={view.unpriced} errors={usage.errors} />
          </div>
        )}
      </div>
      {view && (
        <ShareDialog
          isOpen={isSharing}
          onOpenChange={setIsSharing}
          view={view}
          range={range}
          projectName={project?.name ?? null}
        />
      )}
    </ScrollArea>
  );
}

const ALL_PROJECTS = 'all-projects';
const EVERYWHERE = 'everywhere';

function TargetPicker({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: UsageTarget;
  onChange: (target: UsageTarget) => void;
}) {
  const selected =
    value.kind === 'project'
      ? value.id
      : value.kind === 'everywhere'
        ? EVERYWHERE
        : ALL_PROJECTS;
  return (
    <Select
      value={selected}
      onValueChange={(v) =>
        onChange(
          v === ALL_PROJECTS
            ? { kind: 'projects' }
            : v === EVERYWHERE
              ? { kind: 'everywhere' }
              : { kind: 'project', id: v },
        )
      }
    >
      <SelectTrigger aria-label="Which folders count" className="max-w-60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
          <SelectItem value={EVERYWHERE}>
            Everywhere on this computer
          </SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function SpendSection({ view }: { view: UsageView }) {
  return (
    <section className="grid gap-10 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <p className="type-prose text-muted-foreground">
            API-equivalent spend
          </p>
          <Figure
            value={view.spend.total}
            kind="usd"
            className="text-[72px] leading-[80px] font-extrabold tracking-[-0.045em]"
          />
        </div>
        <SpendSplit view={view} />
        <CachingCompare view={view} />
      </div>
      <Section title="Running total">
        <SpendTrend
          series={view.series}
          isWeekly={view.isWeekly}
          className="h-[260px]"
        />
      </Section>
    </section>
  );
}

function ModelsTable({ models }: { models: UsageView['models'] }) {
  const topCost = Math.max(1, ...models.map((m) => m.cost ?? 0));
  return (
    <Section title="Models" note="Every model that ran, priced at list rates">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="w-[40%]">Spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
            <TableRow key={m.model}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <ProviderMark provider={m.harness} size={14} />
                  {modelName(m.model)}
                </span>
              </TableCell>
              <TableCell className="tabular text-right">
                {compact(m.tokens)}
              </TableCell>
              <TableCell>
                {m.cost === null ? (
                  <span className="text-subtle-foreground">Not priced</span>
                ) : (
                  <span className="flex items-center gap-3">
                    <span
                      className="h-1.5 rounded-sm"
                      style={{
                        width: `${Math.max(1, (m.cost / topCost) * 70)}%`,
                        background:
                          m.harness === 'claude'
                            ? 'var(--color-chart-2)'
                            : 'var(--color-chart-1)',
                      }}
                    />
                    <span className="tabular">{usd(m.cost, 2)}</span>
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function ProjectsTable({
  rows,
  projects,
}: {
  rows: UsageView['projects'];
  projects: Project[];
}) {
  return (
    <Section title="Projects" note="Spend and what shipped, per project">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">PRs merged</TableHead>
            <TableHead className="text-right">Commits</TableHead>
            <TableHead className="text-right">Lines added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.projectId}>
              <TableCell className="max-w-64 truncate">
                {r.projectId === OTHER_FOLDERS
                  ? 'Other folders'
                  : (projects.find((p) => p.id === r.projectId)?.name ??
                    r.projectId)}
              </TableCell>
              <TableCell className="tabular text-right">
                {usd(r.cost, 2)}
              </TableCell>
              <TableCell className="tabular text-right">
                {compact(r.tokens)}
              </TableCell>
              <TableCell className="tabular text-right">
                {r.prsMerged.toLocaleString('en-US')}
              </TableCell>
              <TableCell className="tabular text-right">
                {r.commits.toLocaleString('en-US')}
              </TableCell>
              <TableCell className="tabular text-right text-success">
                +{r.added.toLocaleString('en-US')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function PeriodTable({ view }: { view: UsageView }) {
  const rows = view.series
    .filter((p) => p.tokens > 0 || p.commits > 0 || p.prsMerged > 0)
    .reverse();
  return (
    <Section
      title={view.isWeekly ? 'By week' : 'By day'}
      note="Newest first, days with no activity left out"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{view.isWeekly ? 'Week of' : 'Day'}</TableHead>
            <TableHead className="text-right">Claude Code</TableHead>
            <TableHead className="text-right">Codex</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">PRs merged</TableHead>
            <TableHead className="text-right">Commits</TableHead>
            <TableHead className="text-right">Lines</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.key}>
              <TableCell className="tabular">
                {periodName(p.key, view.isWeekly)}
              </TableCell>
              <TableCell className="tabular text-right">
                {usd(p.cost.claude, 2)}
              </TableCell>
              <TableCell className="tabular text-right">
                {usd(p.cost.codex, 2)}
              </TableCell>
              <TableCell className="tabular text-right">
                {compact(p.tokens)}
              </TableCell>
              <TableCell className="tabular text-right">
                {p.prsMerged}
              </TableCell>
              <TableCell className="tabular text-right">{p.commits}</TableCell>
              <TableCell className="tabular text-right">
                <span className="text-success">
                  +{p.added.toLocaleString('en-US')}
                </span>{' '}
                <span className="text-destructive">
                  −{p.removed.toLocaleString('en-US')}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function Footnote({
  unpriced,
  errors,
}: {
  unpriced: string[];
  errors: string[];
}) {
  return (
    <div className="type-meta flex max-w-[80ch] flex-col gap-1.5 text-subtle-foreground">
      <p>
        Read from Claude Code's and Codex's own logs on this computer, including
        work done outside Mochi: sessions in these projects and their worktrees,
        or every session under Everywhere. Spend is what the tokens would cost
        at API list prices from LiteLLM's public price table (the one ccusage
        uses); a subscription bills differently.
      </p>
      {unpriced.length > 0 && (
        <p>
          No price yet for {unpriced.map(modelName).join(', ')}: their tokens
          count, their spend doesn't.
        </p>
      )}
      {errors.map((e) => (
        <p key={e} className="text-warning">
          {e}
        </p>
      ))}
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-busy>
      <div className="grid gap-10 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="h-[1lh] w-40 rounded-md bg-muted" />
          <div className="h-20 w-64 rounded-xl bg-muted" />
          <div className="h-2 rounded-sm bg-muted" />
        </div>
        <div className="h-[260px] rounded-xl bg-muted/60" />
      </div>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-[1lh] w-24 rounded-md bg-muted" />
            <div className="h-10 w-28 rounded-lg bg-muted" />
            <div className="mt-3 h-10 rounded-md bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Couldn't read usage</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </Empty>
  );
}

function NoUsage({ rangeLabel }: { rangeLabel: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No usage in the last {rangeLabel.toLowerCase()}</EmptyTitle>
        <EmptyDescription>
          Sessions, commits and pull requests in this profile's projects show up
          here. Try a longer range, or start a thread in a project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** `claude-opus-5-5` → Opus 5.5, `gpt-6-astra` → GPT-6 Astra; anything else as reported. */
function modelName(id: string) {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (claude)
    return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] && claude[3].length <= 2 ? `.${claude[3]}` : ''}`;
  const gpt = /^gpt-([\d.]+)-?(.*)$/.exec(id);
  if (gpt)
    return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].replace(/(^|-)(\w)/g, (_, sep: string, c: string) => `${sep ? ' ' : ''}${c.toUpperCase()}`)}` : ''}`;
  return id;
}
