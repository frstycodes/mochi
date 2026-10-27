import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProviderMark, ThreadStatusIcon } from '../../ui';
import { Block, Grid, Section } from '../layout';

const ROWS = [
  {
    title: 'Public API rate limiting',
    provider: 'claude',
    status: 'running',
    pct: 37,
    tokens: '84k',
  },
  {
    title: 'Admin usage dashboard',
    provider: 'codex',
    status: 'running',
    pct: 60,
    tokens: '121k',
  },
  {
    title: 'Fix flaky checkout e2e',
    provider: 'codex',
    status: 'needs-you',
    pct: 53,
    tokens: '46k',
  },
  {
    title: 'Migrate auth to Better Auth and keep every existing session alive',
    provider: 'claude',
    status: 'review',
    pct: 85,
    tokens: '168k',
  },
] as const;

const USAGE = [
  { hour: '09:00', claude: 18, codex: 9 },
  { hour: '10:00', claude: 26, codex: 14 },
  { hour: '11:00', claude: 22, codex: 25 },
  { hour: '12:00', claude: 12, codex: 19 },
  { hour: '13:00', claude: 31, codex: 22 },
  { hour: '14:00', claude: 38, codex: 30 },
];

const CHART = {
  claude: { label: 'Claude', color: 'var(--chart-2)' },
  codex: { label: 'Codex', color: 'var(--chart-1)' },
} satisfies ChartConfig;

export function DataSection() {
  return (
    <Section
      id="data"
      title="Data display"
      intro="Tables for comparing threads, charts for usage over time, and the containers that hold long or resizable content."
    >
      <Block
        title="Table"
        use="Compare threads side by side. Numbers right-aligned and tabular; long titles truncate."
        wide
      >
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableCaption className="pb-3">
              Active threads in Latitude
            </TableCaption>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>Thread</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Progress</TableHead>
                <TableHead className="text-right">Context</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r.title}>
                  <TableCell className="max-w-[320px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <ThreadStatusIcon status={r.status} />
                      <span className="truncate">{r.title}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <ProviderMark provider={r.provider} size={14} />
                      {r.provider === 'claude' ? 'Claude' : 'Codex'}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right">{r.pct}%</TableCell>
                  <TableCell className="tabular text-right">
                    {r.tokens}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>4 threads</TableCell>
                <TableCell className="tabular text-right">419k</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </Block>

      <Grid>
        <Block
          title="Chart"
          use="Usage over time. Series colors follow the agent, never its rank; legend and hover tooltip always on."
        >
          <ChartContainer config={CHART} className="aspect-auto h-56 w-full">
            <AreaChart data={USAGE} margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" />}
              />
              <Area
                dataKey="codex"
                type="monotone"
                stroke="var(--color-codex)"
                fill="var(--color-codex)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                dataKey="claude"
                type="monotone"
                stroke="var(--color-claude)"
                fill="var(--color-claude)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </Block>
        <Block
          title="Avatar"
          use="People on a shared space. Missing images fall back to initials; groups show a count."
        >
          <div className="flex flex-wrap items-center gap-4">
            <Avatar size="lg">
              <AvatarImage src="/does-not-exist.png" alt="" />
              <AvatarFallback>SP</AvatarFallback>
              <AvatarBadge className="bg-success" />
            </Avatar>
            <Avatar>
              <AvatarFallback>IV</AvatarFallback>
            </Avatar>
            <Avatar size="sm">
              <AvatarFallback>MK</AvatarFallback>
            </Avatar>
            <AvatarGroup>
              {['SP', 'IV', 'MK'].map((i) => (
                <Avatar key={i}>
                  <AvatarFallback>{i}</AvatarFallback>
                </Avatar>
              ))}
              <AvatarGroupCount>+4</AvatarGroupCount>
            </AvatarGroup>
          </div>
        </Block>
        <Block
          title="Accordion"
          use="Settings and FAQs where only one part matters at a time."
        >
          <Accordion type="single" collapsible defaultValue="settle">
            <AccordionItem value="settle">
              <AccordionTrigger>When does a thread settle?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                After 3 idle days, or once every linked PR is merged or closed.
                Open questions and running work block it.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="done">
              <AccordionTrigger>When is a goal done?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                When every criterion counts: one with a command once Mochi's
                check passes, one without once the agent claims it with
                evidence.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Block>
        <Block
          title="Resizable"
          use="Split views: chat beside a diff or terminal. Drag the handle."
          wide
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-40 rounded-xl border"
          >
            <ResizablePanel defaultSize="60%">
              <div className="flex h-full items-center justify-center type-meta text-muted-foreground">
                Chat
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="40%">
              <div className="flex h-full items-center justify-center type-meta text-muted-foreground">
                Diff
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </Block>
      </Grid>
    </Section>
  );
}
