import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from '@/toast/store';
import { Chart, Check, Code, Copy, Download, Grid, Image, Maximize, Pip, Route, SidebarRight, type IconComponent } from '@/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PaneVisual } from '../model';
import { useHarness } from '../store';
import { IconSwap, TooltipIconButton } from '../ui';
import { download, serializeSvg, svgToPng } from './exportVisual';
import type { VizLanguage } from './fence';
import { EmbedFrame } from './EmbedFrame';
import { useVizThreadId } from './WidgetVisual';

export interface VisualSource {
  text: string;
  ext: string;
  type: string;
}

/**
 * The embed frame for every inline visual, with its actions (side pane, pop out, copy, download, fullscreen).
 * Without a `fence` (a diagram Streamdown draws, not a harness fence) there is no side pane or pop out, and `icon` names it.
 * `svg` returns the picture as an SVG document; omitted, the first `[data-visual-svg]` inside the body is serialized.
 */
export function VisualFrame({ title, source, svg, canPicture = true, children, ...kind }: ({ fence: PaneVisual } | { fence?: undefined; icon: IconComponent }) & { title: string; source: VisualSource; svg?: () => string; canPicture?: boolean; children: ReactNode }) {
  const fence = kind.fence;
  const body = useRef<HTMLElement>(null);
  const isInPane = useContext(InPaneContext);
  const [isFullscreen, setFullscreen] = useState(false);
  const name = fileName(title);

  const pictureSvg = () => {
    if (svg) return svg();
    const el = body.current?.querySelector<SVGSVGElement>('[data-visual-svg] svg, svg[data-visual-svg]');
    if (!el) throw new Error('Nothing to export yet');
    return serializeSvg(el);
  };
  const exportAs = (what: 'png' | 'svg' | 'source') => async () => {
    try {
      if (what === 'source') return download(`${name}.${source.ext}`, source.text, source.type);
      const doc = pictureSvg();
      if (what === 'svg') return download(`${name}.svg`, doc, 'image/svg+xml');
      download(`${name}.png`, await svgToPng(doc));
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <>
      <EmbedFrame ref={body} icon={kind.fence ? VISUAL_ICONS[kind.fence.language] : kind.icon} title={title} isPadded={!!fence && PADDED.has(fence.language)} className="my-3" actions={<VisualActions fence={fence} title={title} source={source} canPicture={canPicture} isInPane={isInPane} exportAs={exportAs} onFullscreen={() => setFullscreen(true)} />}>
        {children}
      </EmbedFrame>
      <FullscreenDialog title={title} isOpen={isFullscreen} onOpenChange={setFullscreen}>
        {children}
      </FullscreenDialog>
    </>
  );
}

export function FullscreenDialog({ title, isOpen, onOpenChange, children }: { title: string; isOpen: boolean; onOpenChange: (isOpen: boolean) => void; children: ReactNode }) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-auto sm:max-w-[min(calc(100vw-4rem),1100px)] [&_[data-slot=chart]]:h-[min(70dvh,640px)]">
        <DialogTitle className="type-title">{title}</DialogTitle>
        {isOpen && children}
      </DialogContent>
    </Dialog>
  );
}

export const VISUAL_ICONS = { chart: Chart, svg: Image, html: Grid, 'harness-metro': Route, 'harness-diff': Code } satisfies Record<VizLanguage, IconComponent>;

// Agent widgets and SVGs paint their own margins; the harness's own visuals need the frame to.
const PADDED = new Set<VizLanguage>(['chart', 'harness-metro', 'harness-diff']);

function VisualActions({ fence, title, source, canPicture, isInPane, exportAs, onFullscreen }: { fence?: PaneVisual; title: string; source: VisualSource; canPicture: boolean; isInPane: boolean; exportAs: (what: 'png' | 'svg' | 'source') => () => void; onFullscreen: () => void }) {
  return (
    <>
      {!isInPane && !!fence && <PaneButtons fence={fence} title={title} />}
      <CopyButton text={source.text} />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Download">
                <Download />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-40">
          {canPicture && <DropdownMenuItem onSelect={exportAs('png')}>PNG image</DropdownMenuItem>}
          {canPicture && <DropdownMenuItem onSelect={exportAs('svg')}>SVG image</DropdownMenuItem>}
          <DropdownMenuItem onSelect={exportAs('source')}>Source (.{source.ext})</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton label="Fullscreen" onClick={onFullscreen}>
        <Maximize />
      </TooltipIconButton>
    </>
  );
}

const InPaneContext = createContext(false);

/** Wraps a visual shown in a side pane tab, which has no use for its own "open in side pane" and "pop out". */
export const VisualInPane = ({ children }: { children: ReactNode }) => <InPaneContext.Provider value>{children}</InPaneContext.Provider>;

function PaneButtons({ fence, title }: { fence: PaneVisual; title: string }) {
  const { dispatch } = useHarness();
  const threadId = useVizThreadId();
  const open = (isPopped: boolean) => () => dispatch({ type: 'pane-open-tab', threadId, kind: 'visual', title, visual: fence, isPopped });
  return (
    <>
      <TooltipIconButton label="Open in side pane" hint="As a tab next to the preview and changes" onClick={open(false)}>
        <SidebarRight />
      </TooltipIconButton>
      <TooltipIconButton label="Pop out" hint="Into a floating window that follows this thread" onClick={open(true)}>
        <Pip />
      </TooltipIconButton>
    </>
  );
}

const COPIED_MS = 1500;

export function CopyButton({ text, label = 'Copy source' }: { text: string; label?: string }) {
  const { isCopied, copy } = useCopy();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={() => copy(text)}>
          <CopyIcon isCopied={isCopied} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isCopied ? 'Copied' : label}</TooltipContent>
    </Tooltip>
  );
}

export function CopyIcon({ isCopied }: { isCopied: boolean }) {
  return <IconSwap id={isCopied ? 'copied' : 'copy'}>{isCopied ? <Check /> : <Copy />}</IconSwap>;
}

export function useCopy() {
  const [isCopied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast.error('Clipboard is not available');
    }
  };
  return { isCopied, copy };
}

function fileName(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'visual'
  );
}
