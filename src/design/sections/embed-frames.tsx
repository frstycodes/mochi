import type { ReactNode } from 'react';
import { Copy, Download, FileCode, Grid as WidgetGlyph, Image, Maximize, Pip, Refresh, SidebarRight, WarningAlt, type IconComponent } from '@/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from '@/toast/store';
import { TooltipIconButton } from '../../ui';
import { useHarness } from '../../store';
import { VisualFrame } from '../../viz/VisualFrame';
import { VizThreadProvider, WidgetVisual } from '../../viz/WidgetVisual';
import { DEMO_PHOTOS } from '../imageFixtures';
import { CARDED_TICTACTOE_WIDGET, CODE_PREVIEW, TALL_WIDGET, TICTACTOE_WIDGET } from '../embedFixtures';
import { Section } from '../layout';

type Variant = 'flush' | 'slim' | 'frameless' | 'caption';

const VARIANTS = [
  { id: 'flush', name: 'A · Flush', note: 'One hairline frame, content edge to edge. Title and actions float in a pill top-right on hover or focus. Like Claude.ai artifacts, Linear embeds.' },
  { id: 'slim', name: 'B · Slim header', note: 'One frame; a 28px caption bar one surface step up (no divider) carries icon, title and always-visible actions. Content sits directly under it.' },
  { id: 'frameless', name: 'C · Frameless', note: 'No frame. The content keeps its own single radius; only opaque media (image, code) gets a surface. Actions float on hover or focus.' },
  { id: 'caption', name: 'D · Caption below', note: 'Content in one hairline frame; the name in a muted row underneath, like a figure caption. Actions appear in that row on hover or keyboard focus (always shown on touch).' },
] as const satisfies readonly { id: Variant; name: string; note: string }[];

/** Mockups for the embed frame review: each variant renders the same samples at chat width and at a narrow width. */
export function EmbedFramesSection() {
  const { state } = useHarness();
  return (
    <Section
      id="embed-frames"
      title="Embed frames (review)"
      intro="Widgets, MCP app views, fenced visuals and file previews today sit in a titled card with a padded inner frame. Four single-surface alternatives, same samples each. Tab through a frame to reach its actions."
    >
      <VizThreadProvider value={state.threads[0]!.id}>
        <Today />
        {VARIANTS.map((v) => (
          <VariantBoard key={v.id} variant={v.id} name={v.name} note={v.note} />
        ))}
      </VizThreadProvider>
    </Section>
  );
}

function Today() {
  return (
    <Board name="Today" note="The real VisualFrame: card, caption row, 12px padding, then the frame the agent's widget drew for itself. Two surfaces, two radii.">
      <div className="max-w-[640px]">
        <VisualFrame fence={{ language: 'html', code: CARDED_TICTACTOE_WIDGET }} title="Widget" source={{ text: CARDED_TICTACTOE_WIDGET, ext: 'html', type: 'text/html' }}>
          <WidgetVisual source={CARDED_TICTACTOE_WIDGET} title="Widget" />
        </VisualFrame>
      </div>
    </Board>
  );
}

function VariantBoard({ variant, name, note }: { variant: Variant; name: string; note: string }) {
  return (
    <Board name={name} note={note}>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,640px)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <EmbedFrame variant={variant} icon={WidgetGlyph} title="Tic, tac, together" isTransparent>
            <WidgetVisual source={TICTACTOE_WIDGET} title="Tic, tac, together" />
          </EmbedFrame>
          <EmbedFrame variant={variant} icon={Image} title="Screenshot 2026-10-15 at 14.32.png">
            <img src={DEMO_PHOTOS.screenshot.src} alt="" className="block w-full" />
          </EmbedFrame>
          <EmbedFrame variant={variant} icon={FileCode} title="src/http/retryAfter.ts">
            <CodeSample />
          </EmbedFrame>
          <EmbedFrame variant={variant} icon={WidgetGlyph} title="Service latency (20 rows)" isTransparent>
            <div className="max-h-72 overflow-y-auto">
              <WidgetVisual source={TALL_WIDGET} title="Service latency" />
            </div>
          </EmbedFrame>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <p className="type-caption text-subtle-foreground">Narrow chat (340px)</p>
          <EmbedFrame variant={variant} icon={WidgetGlyph} title="Tic, tac, together" isTransparent>
            <WidgetVisual source={TICTACTOE_WIDGET} title="Tic, tac, together" />
          </EmbedFrame>
          <EmbedFrame variant={variant} icon={WidgetGlyph} title="Building widget…">
            <Skeleton className="h-40 w-full rounded-none" />
          </EmbedFrame>
          <EmbedFrame variant={variant} icon={WarningAlt} title="Couldn't render this html">
            <ErrorSample />
          </EmbedFrame>
        </div>
      </div>
    </Board>
  );
}

function Board({ name, note, children }: { name: string; note: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="type-title">{name}</h3>
        <p className="max-w-[72ch] type-meta text-muted-foreground">{note}</p>
      </div>
      {children}
    </div>
  );
}

// isTransparent: the content paints no background of its own (agent widgets, MCP views), so frameless gives it none either.
function EmbedFrame({ variant, icon: Icon, title, isTransparent, children }: { variant: Variant; icon: IconComponent; title: string; isTransparent?: boolean; children: ReactNode }) {
  if (variant === 'slim')
    return (
      <figure className="min-w-0 overflow-hidden rounded-xl ring-1 ring-border">
        <figcaption className="flex h-7 items-center gap-1.5 bg-muted/40 pr-0.5 pl-2.5 type-caption text-muted-foreground">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <Actions />
        </figcaption>
        {children}
      </figure>
    );
  if (variant === 'caption')
    return (
      <figure className="group/embed flex min-w-0 flex-col gap-1">
        <div className="overflow-hidden rounded-xl ring-1 ring-border">{children}</div>
        <figcaption className="flex h-7 items-center gap-1.5 pl-1 type-caption text-subtle-foreground">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className="flex transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-hover/embed:opacity-100 pointer-fine:group-focus-within/embed:opacity-100 group-focus-within/embed:duration-0 has-data-[state=open]:opacity-100">
            <Actions />
          </span>
        </figcaption>
      </figure>
    );
  return (
    <figure className={cn('group/embed relative min-w-0 overflow-hidden rounded-xl', variant === 'flush' && 'ring-1 ring-border', variant === 'frameless' && !isTransparent && 'bg-muted/40')}>
      {children}
      <FloatingBar title={title} />
    </figure>
  );
}

// Same pill as ImageGenCard's actions: opaque so content never shows through, always shown where nothing can hover.
function FloatingBar({ title }: { title: string }) {
  return (
    <figcaption className="absolute top-2 right-2 flex max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-lg bg-popover p-0.5 shadow-float transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-focus-within/embed:opacity-100 group-focus-within/embed:duration-0 pointer-fine:group-hover/embed:opacity-100">
      <span className="min-w-0 truncate px-1.5 type-caption text-muted-foreground">{title}</span>
      <Actions />
    </figcaption>
  );
}

const mock = (what: string) => () => toast(`Would ${what}`);

function Actions() {
  return (
    <span className="flex shrink-0 items-center [&_svg]:size-3.5">
      <TooltipIconButton label="Open in side pane" onClick={mock('open in the side pane')}>
        <SidebarRight />
      </TooltipIconButton>
      <TooltipIconButton label="Pop out" onClick={mock('pop out')}>
        <Pip />
      </TooltipIconButton>
      <TooltipIconButton label="Copy source" onClick={mock('copy the source')}>
        <Copy />
      </TooltipIconButton>
      <TooltipIconButton label="Download" onClick={mock('download')}>
        <Download />
      </TooltipIconButton>
      <TooltipIconButton label="Fullscreen" onClick={mock('open fullscreen')}>
        <Maximize />
      </TooltipIconButton>
    </span>
  );
}

function CodeSample() {
  return <pre className="overflow-x-auto p-3 font-mono type-caption text-foreground">{CODE_PREVIEW}</pre>;
}

function ErrorSample() {
  return (
    <div role="alert" className="flex flex-col gap-2 p-3">
      <span className="flex items-center gap-1.5 type-caption text-muted-foreground">
        <WarningAlt aria-hidden className="size-3.5 shrink-0 text-warning" />
        Unexpected end of input at line 14
      </span>
      <TooltipIconButton label="Retry render" onClick={mock('retry')} className="self-start">
        <Refresh />
      </TooltipIconButton>
    </div>
  );
}
