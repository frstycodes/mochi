import type { ReactNode } from 'react';
import { ArrowSwapHorizontal, ExitFullscreen, Fullscreen, Grid, Layout, Rotation, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useHarness } from '../store';
import { useSplit } from './SplitContext';
import { PRESETS, PRESET_LABELS } from './tree';

/** Per-split actions in a split's header: the layout menu and close. Renders nothing while only one split is open. */
export function SplitControls() {
  const { dispatch } = useHarness();
  const { leafId, isMulti, isZoomed } = useSplit();
  if (!isMulti) return null;
  const run = (action: Parameters<typeof dispatch>[0]) => {
    dispatch({ type: 'layout-focus', leafId });
    dispatch(action);
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Split layout" className="text-muted-foreground">
                <Layout />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Split layout</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => run({ type: 'layout-zoom' })}>
              {isZoomed ? <ExitFullscreen /> : <Fullscreen />}
              {isZoomed ? 'Show all splits' : 'Zoom this split'}
              <DropdownMenuShortcut>Shift Cmd Enter</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isZoomed} onSelect={() => run({ type: 'layout-swap', leafId })}>
              <ArrowSwapHorizontal />
              Swap with next split
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isZoomed} onSelect={() => run({ type: 'layout-rotate' })}>
              <Rotation />
              Rotate this split
            </DropdownMenuItem>
            <PresetSubmenu />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dispatch({ type: 'layout-close', leafId })}>
            <X />
            Close split
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close split" onClick={() => dispatch({ type: 'layout-close', leafId })} className="text-muted-foreground">
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close split</TooltipContent>
      </Tooltip>
    </>
  );
}

function PresetSubmenu() {
  const { dispatch } = useHarness();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Grid />
        Layout presets
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {PRESETS.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => dispatch({ type: 'layout-preset', preset: p })}>
            {PRESET_LABELS[p]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Header for splits that aren't threads (Queue, Board, New thread, a dropped tab). Hidden for a lone split unless it must carry the sidebar toggle. */
export function LeafBar({ children }: { children: ReactNode }) {
  const { isMulti, isFirst } = useSplit();
  const { state, isMobile } = useSidebar();
  const showTrigger = isFirst && (isMobile || state === 'collapsed');
  if (!isMulti && !showTrigger) return null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      {showTrigger && <SidebarTrigger className="-ml-1" />}
      <span className="flex min-w-0 flex-1 items-center gap-2 type-meta font-medium">{children}</span>
      <SplitControls />
    </div>
  );
}
