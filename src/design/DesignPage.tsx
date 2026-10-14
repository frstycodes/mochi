import type { ReactNode } from 'react';
import { ArrowUp, CheckCircle, InfoCircle, Link, Monitor, Moon, Pin, Sun, TextBold, TextItalic, Warning } from 'reicon-react';
import { GitPullRequestIcon } from '@/icons/github';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonGroup } from '@/components/ui/button-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Marker, MarkerContent } from '@/components/ui/marker';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@/components/ui/questionnaire';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Kbd } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { DeviceKind } from '../host/types/remote';
import { DeviceIcon } from '../remote/DeviceIcon';
import { MachinesProvider } from '../remote/useMachines';
import { BoardView } from '../BoardView';
import { seedQueue, type LineSlot, type Thread } from '../model';
import { Orbit } from '../Orbit';
import { QueueDecision } from '../QueueView';
import { ReportCard } from '../goals/ReportCard';
import { TurnChangesCard } from '../chat/TurnChangesCard';
import { turnChanges } from '../chat/turnChanges';
import { PipLayer } from '../Browser';
import { SidePane } from '../SidePane';
import { AppSidebar } from '../Sidebar';
import { SummaryPanel } from '../SummaryPanel';
import { ChatView } from '../ChatView';
import { SplitContext } from '../layout/SplitContext';
import { ReviewModeProvider } from '../review/useReviewMode';
import { HarnessProvider, useHarness } from '../store';
import { ProgressRing, ProviderMark, StepStatusIcon, ThreadStatusIcon, lineColor, stepLabel } from '../ui';
import { ColorPair } from './color-pair';
import { Block, Grid, Section } from './layout';
import { AgentLoaderBlock } from './sections/agent-loader';
import { DataSection } from './sections/data';
import { InputsSection } from './sections/inputs';
import { NavigationSection } from './sections/navigation';
import { OverlaysSection } from './sections/overlays';
import { StateMatrix, previewState } from './state-matrix';
import { Shortcut } from '../Shortcut';
import { SetupRow } from '../chat/SetupRow';
import type { WorktreeSetup } from '../host/types/agent';

const SECTIONS = [
  ['foundations', 'Foundations'],
  ['actions', 'Actions'],
  ['inputs', 'Inputs'],
  ['navigation', 'Navigation'],
  ['display', 'Display'],
  ['data', 'Data'],
  ['feedback', 'Feedback'],
  ['overlays', 'Overlays'],
  ['conversation', 'Conversation'],
  ['recipes', 'Recipes'],
  ['rules', 'Do and don’t'],
] as const;

export function DesignPage() {
  return (
    <HarnessProvider>
      <MachinesProvider>
        <ReviewModeProvider>
          <ScrollArea className="h-full">
            <DesignHeader />
            <main className="mx-auto flex max-w-[1120px] flex-col gap-20 px-4 pt-10 pb-32 md:px-8">
              <Overview />
              <Foundations />
              <Actions />
              <InputsSection />
              <NavigationSection />
              <Display />
              <DataSection />
              <Feedback />
              <OverlaysSection />
              <Conversation />
              <Recipes />
              <Rules />
            </main>
          </ScrollArea>
        </ReviewModeProvider>
      </MachinesProvider>
      <Orbit />
      <Toaster position="bottom-right" />
    </HarnessProvider>
  );
}

function DesignHeader() {
  const { theme = 'system', setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-[1120px] items-center gap-4 px-4 md:px-8">
        <span className="type-title">Mochi</span>
        <Badge variant="secondary" className="hidden sm:inline-flex">
          Design system v0.1
        </Badge>
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto xl:flex" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <Button key={id} variant="ghost" size="xs" asChild>
              <a href={`#design-${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`design-${id}`)?.scrollIntoView({ behavior: 'smooth' }))}>
                {label}
              </a>
            </Button>
          ))}
        </nav>
        <span className="flex-1 xl:hidden" />
        <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(v) => v && setTheme(v)} aria-label="Theme">
          <ToggleGroupItem value="system" aria-label="System theme">
            <Monitor />
          </ToggleGroupItem>
          <ToggleGroupItem value="light" aria-label="Light theme">
            <Sun />
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" aria-label="Dark theme">
            <Moon />
          </ToggleGroupItem>
        </ToggleGroup>
        <Button size="sm" asChild className="hidden sm:inline-flex">
          <a href="#">Open app</a>
        </Button>
      </div>
    </header>
  );
}

function Overview() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="type-display">Mochi design system</h1>
      <p className="max-w-[62ch] type-prose text-muted-foreground">
        Tokens, components and recipes for the agent harness. Built from shadcn/ui, AI Elements and reicon, themed from DESIGN.md. Dark first, cool neutrals,
        squircle corners, hairline separation.
      </p>
      <p className="flex flex-wrap items-center gap-1.5 type-caption text-subtle-foreground">
        Hold <Shortcut keys={['alt']} /> anywhere on this page to try Orbit.
      </p>
    </section>
  );
}

const ROLE_PAIRS = [
  ['background / foreground', 'background', 'foreground'],
  ['background / muted-foreground', 'background', 'muted-foreground'],
  ['background / subtle-foreground', 'background', 'subtle-foreground'],
  ['sidebar / foreground', 'sidebar', 'foreground'],
  ['card / card-foreground', 'card', 'card-foreground'],
  ['popover / popover-foreground', 'popover', 'popover-foreground'],
  ['primary / primary-foreground', 'primary', 'primary-foreground'],
  ['secondary / secondary-foreground', 'secondary', 'secondary-foreground'],
  ['muted / muted-foreground', 'muted', 'muted-foreground'],
  ['accent / accent-foreground', 'accent', 'accent-foreground'],
  ['background / destructive', 'background', 'destructive'],
  ['background / warning', 'background', 'warning'],
  ['background / success', 'background', 'success'],
] as const;

const SWATCHES = [
  ['Surfaces', ['background', 'sidebar', 'card', 'popover', 'float', 'muted', 'accent']],
  ['Ink', ['foreground', 'muted-foreground', 'subtle-foreground', 'primary']],
  ['Lines', ['border', 'input', 'ring', 'chart-grid', 'chart-axis']],
  ['Status', ['success', 'warning', 'destructive']],
  ['Thread lines', ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5']],
  ['Space', ['space']],
] as const;

const TYPE_ROWS = [
  ['type-display', '28/32 · 600 · −0.02em', 'The one big number per surface', '62%'],
  ['type-heading', '20/26 · 600 · −0.012em', 'Page titles', 'Queue'],
  ['type-title', '16/22 · 600', 'Thread, panel and card titles', 'Public API rate limiting'],
  ['type-prose', '15/24 · 400', 'Chat messages, composer', 'Usage queries take 1.8s at 10k keys. I will add a Redis client and cache them.'],
  ['type-body', '14/22 · 400', 'Default UI text', 'Claude keeps building it. This thread waits for that step.'],
  ['type-meta', '13/20 · 400', 'Secondary lines, step rows, sidebar', 'Waiting on Public API rate limiting'],
  ['type-caption', '12/16 · 400', 'Timestamps, counts, tool calls', '14:32 · 6 of 14 pts'],
] as const;

const RADII = [
  ['sm', '8px', 'Badges, kbd, checkboxes', 'rounded-sm'],
  ['md', '10px', 'Rows, menu items, small icon buttons', 'rounded-md'],
  ['lg', '12px', 'Inputs, selects, icon buttons', 'rounded-lg'],
  ['xl', '18px', 'Cards, panels, the summary card', 'rounded-xl'],
  ['2xl', '24px', 'Composer, side pane, sheets', 'rounded-2xl'],
  ['full', 'capsule', 'Text buttons, chips, dots, radios', 'rounded-full'],
] as const;

function Foundations() {
  return (
    <Section
      id="foundations"
      title="Foundations"
      intro="Colour roles with live contrast, the palette, type, radius, elevation and motion. Toggle the theme in the header to re-measure."
    >
      <Block title="Colour roles" use="Each surface with the ink it carries. Contrast is measured live in the current theme." wide>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLE_PAIRS.map(([name, bg, fg]) => (
            <ColorPair key={name} name={name} background={bg} foreground={fg} />
          ))}
        </div>
      </Block>
      <Block title="Palette" use="Grouped by job. Thread lines use the validated categorical order and never colour text." wide>
        <div className="flex flex-col gap-4">
          {SWATCHES.map(([group, tokens]) => (
            <div key={group} className="flex flex-col gap-2">
              <span className="type-caption font-medium text-subtle-foreground">{group}</span>
              <div className="flex flex-wrap gap-3">
                {tokens.map((t) => (
                  <div key={t} className="flex w-28 flex-col gap-1.5">
                    <span className="h-12 rounded-lg ring-1 ring-border" style={{ background: `var(--${t})` }} />
                    <code className="truncate font-mono type-caption text-muted-foreground">{t}</code>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Block>
      <Block title="Type" use="Inter Variable, one family, three weights. Use the type-* utilities, never raw sizes." wide>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="type-caption text-subtle-foreground">
              <tr className="border-b">
                <th className="py-2 pr-4 font-medium">Token</th>
                <th className="py-2 pr-4 font-medium">Spec</th>
                <th className="py-2 pr-4 font-medium">Use</th>
                <th className="py-2 font-medium">Specimen</th>
              </tr>
            </thead>
            <tbody>
              {TYPE_ROWS.map(([token, spec, use, sample]) => (
                <tr key={token} className="border-b align-baseline">
                  <td className="py-3 pr-4 font-mono type-caption whitespace-nowrap">{token}</td>
                  <td className="tabular py-3 pr-4 type-caption whitespace-nowrap text-muted-foreground">{spec}</td>
                  <td className="py-3 pr-4 type-meta text-muted-foreground">{use}</td>
                  <td className={cn('max-w-[360px] truncate py-3', token)}>{sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-[62ch] type-prose">
          Running text sits at 15px in the chat. Paths like <code className="rounded-sm bg-muted px-1 font-mono type-caption">packages/cache/redis.ts</code>{' '}
          switch to mono, and{' '}
          <a href="#design-rules" className="underline underline-offset-4">
            links
          </a>{' '}
          stay in the ink colour with an underline.
        </p>
      </Block>
      <Grid>
        <Block title="Radius" use="Four tiers. Full rounding only for dots and capsules.">
          <div className="flex flex-wrap gap-4">
            {RADII.map(([name, px, use, cls]) => (
              <div key={name} className="flex w-32 flex-col gap-2">
                <span className={cn('h-16 border bg-card', cls)} />
                <span className="type-caption">
                  <b className="font-medium">{name}</b> · {px}
                </span>
                <span className="type-caption text-subtle-foreground">{use}</span>
              </div>
            ))}
          </div>
        </Block>
        <Block title="Elevation" use="Flat, hairline, popover, float. Blur only at float, over content.">
          <div className="relative grid grid-cols-2 gap-4 rounded-xl bg-[repeating-linear-gradient(135deg,var(--muted)_0_8px,transparent_8px_16px)] p-4">
            <ElevationTile label="Flat" detail="Canvas, sidebar" className="bg-background" />
            <ElevationTile label="Hairline" detail="Cards, composer" className="bg-card ring-1 ring-foreground/10" />
            <ElevationTile label="Popover" detail="Menus, tooltips" className="bg-popover shadow-popover" />
            <ElevationTile label="Float" detail="Goal window, PiP" className="surface-float bg-float shadow-float" />
          </div>
        </Block>
        <Block title="Motion" use="Short and interruptible. Keyboard navigation never animates.">
          <table className="w-full border-collapse text-left type-meta">
            <tbody>
              {[
                ['Press', '100–160ms', 'scale 0.97 on active'],
                ['Popover, hover card', '150–200ms ease-out', 'scale from the trigger'],
                ['Hover intent', 'open 160ms, close 240ms', 'goal panel expansion'],
                ['Window snap', 'spring 420 / 36', 'PiP keeps throw velocity'],
                ['Orbit', '100–120ms fade', 'positions never animate'],
              ].map(([name, value, use]) => (
                <tr key={name} className="border-b">
                  <td className="py-2 pr-4">{name}</td>
                  <td className="tabular py-2 pr-4 text-muted-foreground">{value}</td>
                  <td className="py-2 text-subtle-foreground">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
        <Block title="Icons and marks" use="Lucide at 16px in controls, 14px in dense rows. Real brand marks for agents.">
          <div className="flex flex-wrap items-center gap-4">
            <ProviderMark provider="claude" size={20} />
            <ProviderMark provider="codex" size={20} />
            <Separator orientation="vertical" className="h-6" />
            {(['running', 'blocked', 'waiting', 'ready', 'done', 'dropped'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5 type-caption text-muted-foreground">
                <StepStatusIcon status={s} />
                {stepLabel(s)}
              </span>
            ))}
          </div>
        </Block>
      </Grid>
    </Section>
  );
}

function ElevationTile({ label, detail, className }: { label: string; detail: string; className: string }) {
  return (
    <div className={cn('flex h-24 flex-col justify-end rounded-xl p-3', className)}>
      <span className="type-meta font-medium">{label}</span>
      <span className="type-caption text-subtle-foreground">{detail}</span>
    </div>
  );
}

const BUTTON_VARIANTS = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const;

function Actions() {
  return (
    <Section id="actions" title="Actions" intro="The inverted neutral is the primary action. One per group.">
      <Block title="Button" use="Variant × state, pinned so hover, focus and press are visible without interaction." wide>
        <StateMatrix
          rows={BUTTON_VARIANTS}
          states={['default', 'hover', 'focus', 'active', 'disabled', 'loading']}
          render={(variant, state) =>
            state === 'loading' ? (
              <Button variant={variant} disabled>
                <Spinner data-icon="inline-start" />
                Starting
              </Button>
            ) : (
              <Button variant={variant} {...previewState(state)}>
                Start thread
              </Button>
            )
          }
        />
      </Block>
      <Grid>
        <Block title="Sizes and icons" use="xs for dense rows, sm in headers, default in forms and cards.">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline">
              <Link data-icon="inline-start" />
              Link step
            </Button>
            <Button>
              Steer
              <ArrowUp data-icon="inline-end" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Pin">
              <Pin />
            </Button>
            <Button variant="outline" className="max-w-48">
              <span className="truncate">Approve and run the session backfill script</span>
            </Button>
          </div>
        </Block>
        <Block title="Badge" use="Sizes, revisions, PRs, labels. Small radius, never a pill.">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">M</Badge>
            <Badge variant="outline">v3</Badge>
            <Badge variant="secondary">
              <GitPullRequestIcon />
              #482
            </Badge>
            <Badge variant="destructive">Failed</Badge>
            <Badge variant="secondary" className="max-w-40">
              <span className="truncate">packages/cache/redis.ts</span>
            </Badge>
          </div>
        </Block>
        <Block title="Kbd" use="Every shortcut the UI mentions is shown as keys.">
          <div className="flex flex-wrap items-center gap-3 type-meta text-muted-foreground">
            <Shortcut keys={['mod', 'Enter']} />
            <Kbd>N</Kbd>
            <Shortcut keys={['nav', '1']} />
            <span className="flex items-center gap-1.5">
              Hold <Shortcut keys={['alt']} /> for Orbit
            </span>
          </div>
        </Block>
        <Block title="Button group" use="Joined actions that belong together: steer or queue, previous or next.">
          <ButtonGroup>
            <Button variant="outline">Steer</Button>
            <Button variant="outline">Queue</Button>
            <Button variant="outline">Stop</Button>
          </ButtonGroup>
        </Block>
        <Block title="Toggle and toggle group" use="Separate bordered toggles. The selected one gets a stronger border and a fill.">
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} defaultValue="claude" aria-label="Agent">
              <ToggleGroupItem value="claude">
                <ProviderMark provider="claude" size={14} />
                Claude
              </ToggleGroupItem>
              <ToggleGroupItem value="codex">
                <ProviderMark provider="codex" size={14} />
                Codex
              </ToggleGroupItem>
            </ToggleGroup>
            <Toggle variant="outline" size="sm" aria-label="Bold">
              <TextBold />
            </Toggle>
            <Toggle variant="outline" size="sm" defaultPressed aria-label="Italic">
              <TextItalic />
            </Toggle>
          </div>
        </Block>
      </Grid>
    </Section>
  );
}

const DEVICE_SPECIMENS = ['mac', 'windows', 'linux', 'phone', undefined] satisfies (DeviceKind | undefined)[];

function Display() {
  return (
    <Section id="display" title="Display" intro="Items for rows, cards for decisions, rings and bars for progress.">
      <Grid>
        <Block title="Item" use="Rows with media, a title, a description and a trailing slot.">
          <div className="flex flex-col gap-2">
            <Item variant="outline">
              <ItemMedia variant="icon">
                <Link />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  Link <Badge variant="secondary">Suggested</Badge>
                </ItemTitle>
                <ItemDescription>Claude keeps building it. This thread waits for that step.</ItemDescription>
              </ItemContent>
              <Kbd>1</Kbd>
            </Item>
            <Item variant="muted">
              <ItemMedia>
                <ProviderMark provider="codex" size={20} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Admin usage dashboard with an unusually long title that needs to truncate gracefully</ItemTitle>
                <ItemDescription>Codex · running · 57%</ItemDescription>
              </ItemContent>
            </Item>
          </div>
        </Block>
        <Block title="Device" use="A computer or phone of yours, lit like Mochi in its own subtle colour; the same in both themes.">
          <div data-design="devices" className="flex flex-col gap-4">
            <div className="flex items-end gap-6">
              {DEVICE_SPECIMENS.map((kind) => (
                <DeviceIcon key={kind ?? 'unknown'} kind={kind} className="size-12" />
              ))}
            </div>
            <div className="flex items-center gap-6 type-meta text-muted-foreground">
              {DEVICE_SPECIMENS.map((kind) => (
                <span key={kind ?? 'unknown'} className="flex items-center gap-1.5">
                  <DeviceIcon kind={kind} />
                  {kind ?? 'unknown'}
                </span>
              ))}
            </div>
          </div>
        </Block>
        <Block title="Card" use="Decisions and grouped content. Hairline ring, no shadow.">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Approval · Migrate auth to Better Auth</CardDescription>
              <CardTitle>Run the session backfill</CardTitle>
            </CardHeader>
            <CardContent className="type-body text-muted-foreground">Rewrites 18,204 rows in the local sessions table.</CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Approve and run</Button>
              <Button size="sm" variant="outline">
                Open thread
              </Button>
            </CardFooter>
          </Card>
        </Block>
        <Block
          title="Progress"
          use="One segment per criterion, in the thread's line colour, the count beside it; green once all are met, spinning while the agent works, no count without criteria. Never a percent."
        >
          <div className="flex flex-col gap-3">
            {RING_SAMPLES.map(({ met, total, isWorking }, i) => (
              <div key={i} className="flex items-center gap-2 type-caption text-muted-foreground">
                <ProgressRing met={met} total={total} slot={((i % 5) + 1) as LineSlot} isWorking={isWorking} />
                <span className="tabular">{total ? `${met}/${total}` : 'No criteria'}</span>
                {isWorking && <span>Working</span>}
              </div>
            ))}
          </div>
        </Block>
        <Block title="Collapsible" use="Show more on demand: settled threads, long tool output.">
          <Collapsible className="flex flex-col gap-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="self-start">
                Settled · 1
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 type-meta text-muted-foreground">Onboarding emails</CollapsibleContent>
          </Collapsible>
        </Block>
        <Block title="Scroll area and separator" use="Long lists inside fixed panels.">
          <ScrollArea className="h-40 rounded-xl border">
            <div className="flex flex-col p-3">
              {[
                'Read packages/cache/index.ts',
                'Edit packages/cache/redis.ts  +38 −0',
                'Run pnpm --filter cache test',
                'Edit packages/cache/index.ts  +4 −0',
                'Read apps/api/gateway.ts',
                'Run pnpm --filter api test ratelimit',
                'Edit apps/api/middleware/ratelimit.ts  +22 −3',
              ].map((t, i) => (
                <div key={t}>
                  {i > 0 && <Separator className="my-2" />}
                  <span className="font-mono type-caption text-muted-foreground">{t}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Block>
      </Grid>
    </Section>
  );
}

function Feedback() {
  return (
    <Section id="feedback" title="Feedback" intro="Toasts carry undo. Alerts explain. Skeletons copy the shape of what loads.">
      <Grid>
        <Block title="Alert" use="Inline explanations. Status colour always comes with an icon.">
          <div className="flex flex-col gap-2">
            <Alert>
              <InfoCircle />
              <AlertTitle>Overlap caught before any duplicate work</AlertTitle>
              <AlertDescription>Two threads want to add a Redis client. Decide in the Queue.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <Warning />
              <AlertTitle>Setup script failed in feat/admin-usage</AlertTitle>
              <AlertDescription>pnpm install exited with code 1. The agent is paused until it passes.</AlertDescription>
            </Alert>
          </div>
        </Block>
        <Block title="Toast" use="Every reversible action gets an undo.">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                toast('Thread settled', { description: 'Idle terminals closed, PR watches stopped.', action: { label: 'Undo', onClick: () => undefined } })
              }
            >
              Settle a thread
            </Button>
            <Button variant="outline" onClick={() => toast.success('Merged #482')}>
              <CheckCircle data-icon="inline-start" />
              Merge
            </Button>
          </div>
        </Block>
        <Block title="Loading" use="Spinner inside controls, skeletons shaped like the content.">
          <div className="flex items-center gap-3 type-meta text-muted-foreground">
            <Spinner /> Starting Codex in feat/admin-usage
          </div>
          <div className="flex flex-col gap-2.5">
            {[64, 48, 72].map((w) => (
              <div key={w} className="flex items-center gap-2">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-3" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </Block>
        <AgentLoaderBlock />
        <Block title="Empty" use="Acknowledge, explain, offer one action.">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle />
              </EmptyMedia>
              <EmptyTitle>Nothing needs you</EmptyTitle>
              <EmptyDescription>Questions, approvals and overlaps show up here, most blocking first.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Block>
      </Grid>
    </Section>
  );
}

function Conversation() {
  const { state } = useHarness();
  const adm = state.threads.find((t) => t.id === 'adm')!;
  return (
    <Section
      id="conversation"
      title="Conversation"
      intro="AI Elements on live demo data: messages, reasoning, the tool-call chain, inline decisions and the prompt input. Reasoning and tool chains collapse like Codex's work log."
    >
      <div className="flex h-[620px] flex-col overflow-hidden rounded-xl border">
        <SplitContext.Provider value={{ leafId: 'design', isFocused: false, isMulti: false, isZoomed: false, isFirst: false, isWide: true }}>
          <ChatView thread={adm} />
        </SplitContext.Provider>
      </div>
      <Grid>
        <Block title="Questionnaire" use="How agents ask you things: one choice, number keys, then send.">
          <Questionnaire
            items={[{ name: 'stripe', required: true, choices: [{ value: 'stub' }, { value: 'record' }] }]}
            defaultItem="stripe"
            shortcuts="numbers"
            onSubmit={(e) => (e.preventDefault(), toast('Answer sent'))}
          >
            <QuestionnaireItem name="stripe" required>
              <QuestionnaireTitle>Stub Stripe webhooks or record fixtures?</QuestionnaireTitle>
              <QuestionnaireChoices>
                <QuestionnaireChoice value="stub">Stub webhooks</QuestionnaireChoice>
                <QuestionnaireChoice value="record">Record fixtures</QuestionnaireChoice>
              </QuestionnaireChoices>
            </QuestionnaireItem>
            <QuestionnaireActions>
              <QuestionnaireSubmit size="sm">Send answer</QuestionnaireSubmit>
            </QuestionnaireActions>
          </Questionnaire>
        </Block>
        <Block
          wide
          title="Worktree setup"
          use="Tops a new worktree thread while its ignored files, dependencies and setup command get ready; the agent starts after. Open while it runs or waits on you, folded once done."
        >
          <div className="flex flex-col gap-4">
            {SETUP_SAMPLES.map((setup) => (
              <SetupRow key={setup.status} thread={adm} setup={setup} />
            ))}
          </div>
        </Block>
        <Block title="Event marker" use="Mochi events you would scroll back to: finished steps, goal revisions, overlaps.">
          <Marker variant="separator">
            <MarkerContent className="type-caption">Goal v2: +1 step "Per-key overrides"</MarkerContent>
          </Marker>
        </Block>
      </Grid>
    </Section>
  );
}

function Recipes() {
  const { state, dispatch } = useHarness();
  const adm = state.threads.find((t) => t.id === 'adm')!;
  const admPane = state.panes.find((p) => p.threadId === 'adm');
  const rl = state.threads.find((t) => t.id === 'rl')!;
  const decision = state.queue.find((q) => q.kind === 'question') ?? seedQueue()[1];

  return (
    <Section id="recipes" title="Recipes" intro="The harness’s own components, running on live demo data. These are the acceptance tests for the tokens.">
      <Grid>
        <Block title="Sidebar" use="Space tint, nav, pinned threads with status, marks and rings. Swipe sideways to change space.">
          <div className="h-[560px] w-[256px] overflow-hidden rounded-xl border">
            <SidebarProvider className="h-full min-h-0">
              <AppSidebar onSearch={() => toast('Opens the Cmd K palette in the app')} collapsible="none" />
            </SidebarProvider>
          </div>
        </Block>
        <Block
          title="Summary card"
          use="Codex-style card under its header toggle: goal, changes, context, PRs, skills used, tools called, sources. Hover the goal for the full timeline."
        >
          <div className="flex h-[560px] justify-end overflow-hidden rounded-xl border">
            <SummaryPanel thread={rl} className="m-3 w-[300px] rounded-xl bg-popover shadow-popover" />
          </div>
        </Block>
        <Block
          title="Report card"
          use="End of a turn of work on a goal: what needs you, criteria with the agent's evidence, decisions, what's left, the turn's changes."
          wide
        >
          <ReportCard thread={reportFixture(rl)} />
        </Block>
        <Block
          title="Report, criteria met"
          use="Every criterion met: the card names what's next and offers it. No PR yet, so Open pull request asks the agent to run open_pr; with a PR open the chip is the next step; merged, Settle thread."
          wide
        >
          <ReportCard thread={metReportFixture(rl)} />
        </Block>
        <Block
          title="Turn changes"
          use="Under a finished turn that changed files, like Claude's: totals and Undo, a row per file opening to its diff, the first three then Show more. Undo is disabled here: these threads have no worktree."
          wide
        >
          <div className="flex flex-col gap-3">
            {turnChanges(changesFixture(rl).activity).map((turn) => (
              <TurnChangesCard key={turn.start} thread={changesFixture(rl)} turn={turn} />
            ))}
          </div>
        </Block>
        <Block title="Queue decision" use="Same card in the Queue and inline at the end of a chat." wide>
          <QueueDecision item={decision} showThread />
        </Block>
        <Block title="Same files" use="Two live threads of one project edited the same file; never pauses either agent." wide>
          <QueueDecision
            item={{
              id: 'q-collision-demo',
              kind: 'collision',
              threadId: rl.id,
              title: `"${adm.title}" is editing the same file`,
              detail: '',
              blocks: { steps: 0, threads: 2 },
              createdAt: rl.startedAt,
              collision: { otherThreadId: adm.id, files: ['apps/api/middleware/ratelimit.ts'] },
            }}
            showThread
          />
        </Block>
        <Block
          title="Side pane"
          use="One card per pane kind beside the chat, like Claude: each has its own header with its tabs or title, its actions, ⋯, expand and close. Panes stack in columns and fold to their header when there is no room."
          wide
        >
          <div className="h-[460px] overflow-hidden rounded-xl border">{admPane && <SidePane thread={adm} pane={admPane} />}</div>
        </Block>
        <Block
          title="Floating window"
          use="Chromeless, like Codex: hover to reveal close and put back over a blurred corner that spills past the edge. Drag anywhere and throw it to a corner, past the edge to tuck it away. The browser floats on its own while the agent drives it off screen, as a scaled-down, view-only mirror."
          wide
        >
          <div className="relative h-[560px] overflow-hidden rounded-xl border bg-[repeating-linear-gradient(135deg,var(--muted)_0_8px,transparent_8px_16px)]">
            <PipLayer thread={adm} />
            {!admPane?.tabs.some((t) => t.isPopped && t.kind !== 'browser') && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button onClick={() => admPane && dispatch({ type: 'pane-pop', threadId: 'adm', tabId: admPane.tabs[1].id, isPopped: true })}>
                  Pop out the changes
                </Button>
              </div>
            )}
          </div>
        </Block>
        <Block title="Metro board" use="Threads as lines, steps as stations, shared steps as interchanges." wide>
          <div className="h-[460px] overflow-hidden rounded-xl border">
            <BoardView />
          </div>
        </Block>
        <Block title="Thread states" use="Status icons always sit next to a word or a title.">
          <div className="flex flex-col gap-2">
            {(['running', 'needs-you', 'review', 'settled'] as const).map((s) => (
              <span key={s} className="flex items-center gap-2 type-meta">
                <span className="flex w-4 justify-center">
                  <ThreadStatusIcon status={s} />
                </span>
                {{ running: 'Running', 'needs-you': 'Needs you', review: 'Ready for review', settled: 'Settled' }[s]}
              </span>
            ))}
          </div>
        </Block>
      </Grid>
    </Section>
  );
}

function Rules() {
  return (
    <Section id="rules" title="Do and don’t" intro="The rules that are easiest to break.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Pair rule="One primary action per group.">
          <div className="flex gap-2">
            <Button>Approve and run</Button>
            <Button variant="outline">Open thread</Button>
          </div>
          <div className="flex gap-2">
            <Button>Approve and run</Button>
            <Button>Open thread</Button>
          </div>
        </Pair>
        <Pair rule="Line colour marks identity. Text stays in ink.">
          <span className="flex items-center gap-2 type-meta">
            <span aria-hidden className="size-2 rounded-full" style={{ background: lineColor(2) }} />
            Admin usage dashboard
          </span>
          <span className="type-meta" style={{ color: lineColor(2) }}>
            Admin usage dashboard
          </span>
        </Pair>
        <Pair rule="Status needs an icon or a word, not colour alone.">
          <span className="flex items-center gap-2 type-meta">
            <Warning className="size-4 text-warning" />
            Needs you: answer the Stripe question
          </span>
          <span className="flex items-center gap-2 type-meta">
            <span className="size-2 rounded-full bg-warning" />
            Fix flaky checkout e2e
          </span>
        </Pair>
        <Pair rule="Blur only for windows that float over content.">
          <div className="surface-float rounded-xl bg-float p-3 type-meta shadow-float">Floating goal window</div>
          <div className="surface-float rounded-xl bg-float p-3 type-meta">Ordinary card with glass</div>
        </Pair>
      </div>
    </Section>
  );
}

function Pair({ rule, children }: { rule: string; children: [ReactNode, ReactNode] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-meta font-medium">{rule}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-h-24 flex-col justify-center gap-2 rounded-xl border p-4">
          <span className="type-caption font-medium text-success">Do</span>
          {children[0]}
        </div>
        <div className="flex min-h-24 flex-col justify-center gap-2 rounded-xl border p-4">
          <span className="type-caption font-medium text-destructive">Don’t</span>
          {children[1]}
        </div>
      </div>
    </div>
  );
}

const RING_SAMPLES = [
  { met: 0, total: 3, isWorking: true },
  { met: 1, total: 3, isWorking: true },
  { met: 2, total: 5, isWorking: false },
  { met: 4, total: 4, isWorking: false },
  { met: 0, total: 0, isWorking: true },
  { met: 0, total: 0, isWorking: false },
];

function metReportFixture(rl: Thread): Thread {
  const at = rl.activity.at(-1)?.at ?? 0;
  const claim = { evidence: 'pnpm test: 214 passed', at, by: 'claude' as const };
  return {
    ...reportFixture(rl),
    prs: [],
    criteria: [
      { id: 'c1', text: 'Every 429 carries Retry-After', claim },
      { id: 'c2', text: 'pnpm test passes', command: 'pnpm test', claim },
    ],
    report: { at, by: 'claude', decisions: ['Kept the plain-text 429 body'], left: [] },
  };
}

/** A goal thread as it looks after its agent claimed one criterion and reported. */
function reportFixture(rl: Thread): Thread {
  const at = rl.activity.at(-1)?.at ?? 0;
  return {
    ...rl,
    live: undefined,
    criteria: [
      { id: 'c1', text: 'Every 429 carries Retry-After', claim: { evidence: 'curl -i /v1/search shows Retry-After: 30', at, by: 'claude' } },
      { id: 'c2', text: 'pnpm test passes', command: 'pnpm test' },
    ],
    report: {
      at,
      by: 'claude',
      decisions: ['Kept the plain-text 429 body so existing clients keep parsing it'],
      left: ['Per-key overrides in the admin UI'],
      question: 'Switch the 429 body to JSON now, or in a follow-up?',
    },
  };
}

const CHANGED_FILES = [
  'packages/cache/redis.ts',
  'apps/api/routes/admin/usage.ts',
  'apps/web/routes/admin/usage.tsx',
  'apps/api/middleware/ratelimit.ts',
  'apps/api/middleware/__tests__/ratelimit.integration.test.ts',
  'apps/api/gateway.ts',
  'packages/db/schema/limits.ts',
  'packages/db/migrations/0042_api_limits.sql',
  'docs/api/limits.md',
  'apps/web/components/charts/BarChart.tsx',
  'apps/web/routes/admin/usage.css',
  'scripts/load/ratelimit.k6.js',
  'package.json',
  'README.md',
];

/** One turn that changed 14 files, then a small one whose changes were undone. */
function changesFixture(rl: Thread): Thread {
  const at = rl.activity.at(-1)?.at ?? 0;
  const tool = (text: string): Thread['activity'][number] => ({ at, who: 'claude', kind: 'tool', text });
  return {
    ...rl,
    live: undefined,
    activity: [
      { at, who: 'you', kind: 'message', text: 'Wire the limits through the gateway and the admin page' },
      ...CHANGED_FILES.map((path, i) => tool(`${i % 4 === 1 ? 'Write' : 'Edit'} ${path}  +${((i * 37) % 210) + 4} −${i % 3 === 0 ? 0 : i * 2}`)),
      { at, who: 'claude', kind: 'message', text: 'Wired through. Tests pass.' },
      { at, who: 'you', kind: 'message', text: 'Bump the README too' },
      tool('Edit README.md  +3 −1'),
      { at, who: 'claude', kind: 'message', text: 'Done.' },
      {
        at,
        who: 'harness',
        kind: 'event',
        text: 'Undid the changes to 1 file from "Bump the README too"',
        turnUndo: { start: CHANGED_FILES.length + 2, isUndone: true },
      },
    ],
  };
}

const AGO = Date.now();
const COPY = {
  id: 'copy',
  label: 'Copy .env, .env.local',
  status: 'done',
  startedAt: AGO - 14_000,
  endedAt: AGO - 13_800,
  output: '.env\n.env.local',
} as const;
const INSTALL = {
  id: 'install',
  label: 'Install dependencies with pnpm',
  command: 'pnpm install --frozen-lockfile --prefer-offline',
  startedAt: AGO - 13_800,
} as const;
const SCRIPT = { id: 'script', label: 'Run setup command', command: 'pnpm build:native' } as const;

const SETUP_SAMPLES: WorktreeSetup[] = [
  {
    status: 'running',
    startedAt: AGO - 14_000,
    steps: [
      COPY,
      {
        ...INSTALL,
        status: 'running',
        output: 'Lockfile is up to date, resolution step is skipped\nProgress: resolved 812, reused 812, downloaded 0, added 640\n',
      },
      { ...SCRIPT, status: 'pending' },
    ],
  },
  {
    status: 'failed',
    startedAt: AGO - 14_000,
    steps: [
      COPY,
      { ...INSTALL, status: 'done', endedAt: AGO - 9_000 },
      {
        ...SCRIPT,
        status: 'failed',
        startedAt: AGO - 9_000,
        endedAt: AGO - 6_000,
        exitCode: 1,
        output: 'node-gyp rebuild\ngyp ERR! find Python Python is not set from command line or npm configuration\n',
      },
    ],
  },
  {
    status: 'ready',
    startedAt: AGO - 14_000,
    endedAt: AGO,
    steps: [COPY, { ...INSTALL, status: 'done', endedAt: AGO - 2_000 }, { ...SCRIPT, status: 'done', startedAt: AGO - 2_000, endedAt: AGO }],
  },
];
