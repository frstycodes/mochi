import type { ReactNode } from 'react';
import { ArrowSwapHorizontal, ArrowUp, CarouselH, ExitFullscreen, Export, Fullscreen, Grid, Layout, Rotation, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { host } from '@/host';
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
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useHarness } from '../store';
import { useSplit } from './SplitContext';
import { findLeaf, PRESETS, PRESET_LABELS } from './tree';

/** Per-split actions in a split's header: the Stage Manager toggle (first split only), the layout menu and close. */
export function SplitControls() {
  const { state, dispatch } = useHarness();
  const { leafId, isMulti, isZoomed, isFirst } = useSplit();
  if (!isMulti) return isFirst && <StageToggle />;
  const run = (action: Parameters<typeof dispatch>[0]) => {
    dispatch({ type: 'layout-focus', leafId });
    dispatch(action);
  };
  const view = findLeaf(state.layouts[state.spaceId].root, leafId)?.view;
  const tearOff = view?.kind === 'thread' ? () => {
    void host.windows.open(`window/${view.id}`);
    dispatch({ type: 'layout-close', leafId });
  } : undefined;

  return (
    <>
      {isFirst && <StageToggle />}
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
            {!!tearOff && (
              <DropdownMenuItem onSelect={tearOff}>
                <Export />
                Move to a new window
              </DropdownMenuItem>
            )}
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

function StageToggle() {
  const { state, dispatch } = useHarness();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Stage Manager" aria-pressed={state.isStage} onClick={() => dispatch({ type: 'stage-toggle' })} className={cn('text-muted-foreground', state.isStage && 'bg-accent text-foreground')}>
          <CarouselH />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {state.isStage ? 'Leave Stage Manager' : 'Stage Manager'}
        <KbdGroup>
          <Kbd>Shift</Kbd>
          <Kbd>Cmd</Kbd>
          <Kbd>S</Kbd>
        </KbdGroup>
        <span className="text-subtle-foreground">All sessions</span>
        <KbdGroup>
          <Kbd>Cmd</Kbd>
          <Kbd aria-label="Up arrow"><ArrowUp /></Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
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
