import type { ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { MetricsSnapshot } from '@mochi/core/metrics/schema';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Monitor, X } from '@/icons';
import { cpuSeries, gpuSeconds } from '../developer/chartData';
import { useMetrics } from '../developer/useMetrics';
import { host } from '../host';
import { BoundShortcut } from '../Shortcut';
import { useHarness } from '../store';
import { TitleBar } from '../TitleBar';
import { TooltipIconButton } from '../ui';
import { goBack, useEscapeBack } from './nav';

/** What the app is doing to the machine right now: Electron's processes, and Core's spawns, watches, events and spans. Opened from the command menu. */
export function DeveloperPage() {
  useEscapeBack();
  const { history, latest, error } = useMetrics();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DeveloperHeader />
      {!host.isDesktop ? <DesktopOnly /> : error ? <MetricsError message={error.message} /> : latest ? <Sections history={history} latest={latest} /> : <MetricsSkeleton />}
    </div>
  );
}

function DeveloperHeader() {
  return (
    <TitleBar>
      <Monitor aria-hidden className="size-4 text-muted-foreground" />
      <span className="type-meta font-medium">Developer</span>
      <span className="flex-1" />
      <TooltipIconButton label="Close developer page" hint={<BoundShortcut command="dismiss" />} onClick={goBack}>
        <X />
      </TooltipIconButton>
    </TitleBar>
  );
}

function Sections({ history, latest }: { history: ReadonlyArray<MetricsSnapshot>; latest: MetricsSnapshot }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 pt-2 pb-12">
        <Section title="Processes" meta={`GPU process CPU time ${seconds(gpuSeconds(latest))}`}>
          <CpuChart history={history} />
          <ProcessTable processes={latest.processes} />
        </Section>
        <Section title="Spawns per minute">
          <SpawnTable spawns={latest.spawns} />
        </Section>
        <Section title="Watch subscriptions">
          <WatchTable watches={latest.watches} />
        </Section>
        <Section title="Events per second">
          <EventTable events={latest.events} />
        </Section>
        <Section title="Recent spans">
          <SpanTable spans={latest.spans} />
        </Section>
        <Section title="Log file">
          <p className="type-meta break-all font-mono select-text text-muted-foreground">{latest.logFile ?? 'Not set'}</p>
        </Section>
      </div>
    </ScrollArea>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-title">{title}</h2>
        {!!meta && <span className="tabular type-caption text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

const CPU_CONFIG = { total: { label: 'All processes', color: 'var(--chart-1)' }, gpu: { label: 'GPU process', color: 'var(--chart-3)' } } satisfies ChartConfig;

function CpuChart({ history }: { history: ReadonlyArray<MetricsSnapshot> }) {
  return (
    <ChartContainer config={CPU_CONFIG} className="aspect-auto h-40 w-full">
      <LineChart data={cpuSeries(history)} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="at" hide />
        <YAxis tickLine={false} axisLine={false} width={44} tickMargin={4} tickFormatter={(value: number) => `${Math.round(value)}%`} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, [point]) => clock.format(point?.payload.at)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="total" type="monotone" stroke="var(--color-total)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="gpu" type="monotone" stroke="var(--color-gpu)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}

function ProcessTable({ processes }: { processes: MetricsSnapshot['processes'] }) {
  if (processes.length === 0) return <Nothing>Main isn't reporting its processes yet.</Nothing>;
  return (
    <DataTable heads={['Process', 'CPU', 'CPU time', 'Memory']} numeric={[1, 2, 3]}>
      {[...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).map((p) => (
        <TableRow key={p.pid} className={p.type === 'GPU' ? 'font-medium' : undefined}>
          <TableCell>
            {p.name ?? p.type} <span className="type-caption font-normal text-muted-foreground">{p.name && p.name !== p.type ? `${p.type} · ` : ''}{p.pid}</span>
          </TableCell>
          <TableCell className="tabular text-right">{percent.format(p.cpuPercent / 100)}</TableCell>
          <TableCell className="tabular text-right">{seconds(p.cpuSeconds)}</TableCell>
          <TableCell className="tabular text-right">{megabytes.format(p.workingSetKb / 1024)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function SpawnTable({ spawns }: { spawns: MetricsSnapshot['spawns'] }) {
  if (spawns.length === 0) return <Nothing>Core hasn't started a process in the last minute.</Nothing>;
  return (
    <DataTable heads={['Binary', 'Per minute']} numeric={[1]}>
      {spawns.map((s) => (
        <TableRow key={s.binary}>
          <TableCell>{s.binary}</TableCell>
          <TableCell className="tabular text-right">{s.perMinute}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function WatchTable({ watches }: { watches: MetricsSnapshot['watches'] }) {
  if (watches.length === 0) return <Nothing>No window is watching anything.</Nothing>;
  return (
    <DataTable heads={['Watch', 'Subscribers', 'Reads']} numeric={[1, 2]}>
      {watches.map((w) => (
        <TableRow key={`${w.kind}:${w.target}`}>
          <TableCell className="max-w-0 truncate">
            {w.kind} {!!w.target && <span className="type-caption text-muted-foreground">{w.target}</span>}
          </TableCell>
          <TableCell className="tabular text-right">{w.subscribers}</TableCell>
          <TableCell className="tabular text-right">{w.intervalMs === null ? 'On change' : `Every ${seconds(w.intervalMs / 1000)}`}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function EventTable({ events }: { events: MetricsSnapshot['events'] }) {
  const { state } = useHarness();
  if (events.length === 0) return <Nothing>No thread logged an event in the last ten seconds.</Nothing>;
  return (
    <DataTable heads={['Thread', 'Per second']} numeric={[1]}>
      {events.map((e) => (
        <TableRow key={e.threadId}>
          <TableCell className="max-w-0 truncate">{state.threads.find((t) => t.id === e.threadId)?.title ?? e.threadId}</TableCell>
          <TableCell className="tabular text-right">{rate.format(e.perSecond)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function SpanTable({ spans }: { spans: MetricsSnapshot['spans'] }) {
  if (spans.length === 0) return <Nothing>No span has ended yet.</Nothing>;
  return (
    <DataTable heads={['Span', 'Took', 'Ended']} numeric={[1, 2]}>
      {spans.slice(0, 15).map((s, i) => (
        <TableRow key={`${s.endedAt}:${i}`}>
          <TableCell className="max-w-0 truncate">
            {s.name} {!s.isOk && <span className="type-caption text-destructive">failed</span>}
          </TableCell>
          <TableCell className="tabular text-right">{`${duration.format(s.durationMs)} ms`}</TableCell>
          <TableCell className="tabular text-right text-muted-foreground">{clock.format(s.endedAt)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function DataTable({ heads, numeric, children }: { heads: string[]; numeric: number[]; children: ReactNode }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          {heads.map((head, i) => (
            <TableHead key={head} className={numeric.includes(i) ? 'w-28 text-right' : undefined}>
              {head}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="type-meta text-muted-foreground">{children}</p>;
}

function MetricsSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 pt-2">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function MetricsError({ message }: { message: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Core stopped sending metrics</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DesktopOnly() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Metrics need the desktop app</EmptyTitle>
        <EmptyDescription>Core and Electron's process list only exist there.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const megabytes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 });
const rate = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const duration = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const seconds = (value: number) => new Intl.NumberFormat(undefined, { style: 'unit', unit: 'second', maximumFractionDigits: 1 }).format(value);
