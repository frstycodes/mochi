import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Download, Maximize, Pip, SidebarRight } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PaneVisual } from '../model';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import { download, serializeSvg, svgToPng } from './exportVisual';
import { useVizThreadId } from './WidgetVisual';

export interface VisualSource {
  text: string;
  ext: string;
  type: string;
}

/**
 * Card chrome shared by every inline visual: caption, hover toolbar (copy, download, fullscreen).
 * `svg` returns the picture as an SVG document; omitted, the first `[data-visual-svg]` inside the body is serialized.
 */
export function VisualFrame({ fence, title, source, svg, canPicture = true, children }: { fence: PaneVisual; title: string; source: VisualSource; svg?: () => string; canPicture?: boolean; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
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
    <figure data-visual className="group/visual relative my-3 flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-border">
      <figcaption className={cn('flex h-6 items-center gap-2 type-caption text-subtle-foreground', isInPane ? 'pr-24' : 'pr-40')}>
        <span className="truncate">{title}</span>
      </figcaption>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/visual:opacity-100 group-focus-within/visual:opacity-100 has-data-[state=open]:opacity-100 pointer-coarse:opacity-100">
        {!isInPane && <PaneButtons fence={fence} title={title} />}
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Fullscreen" onClick={() => setFullscreen(true)}>
              <Maximize />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fullscreen</TooltipContent>
        </Tooltip>
      </div>
      <div ref={body} className="min-w-0">
        {children}
      </div>
      <Dialog open={isFullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-auto sm:max-w-[min(calc(100vw-4rem),1100px)] [&_[data-slot=chart]]:h-[min(70dvh,640px)]">
          <DialogTitle className="type-title">{title}</DialogTitle>
          {isFullscreen && children}
        </DialogContent>
      </Dialog>
    </figure>
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

function CopyButton({ text, label = 'Copy source' }: { text: string; label?: string }) {
  const [isCopied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast.error('Clipboard is not available');
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={copy}>
          {isCopied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isCopied ? 'Copied' : label}</TooltipContent>
    </Tooltip>
  );
}

function fileName(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'visual'
  );
}
