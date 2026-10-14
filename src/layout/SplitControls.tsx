import type { ReactNode } from 'react';
import { ArrowSwapHorizontal, ExitFullscreen, Export, Fullscreen, Grid, Layout, Rotation, X } from 'reicon-react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToggleSlot } from '../SidebarToggle';
import { DragStrip, TitleBar } from '../TitleBar';
import { useHarness } from '../store';
import { useSplit } from './SplitContext';
import { findLeaf, PRESETS, PRESET_LABELS } from './tree';
import { BoundShortcut } from '../Shortcut';
import { SPLIT_MENU } from '../menus/menus';
import { TargetContextMenu } from '../menus/TargetContextMenu';

/** Per-split actions in a split's header: the layout menu and close. */
export function SplitControls() {
  const { state, dispatch } = useHarness();
  const { leafId, isMulti, isZoomed } = useSplit();
  if (!isMulti) return null;
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
              <DropdownMenuShortcut>
                <BoundShortcut command="layout-zoom" />
              </DropdownMenuShortcut>
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

/** Header for splits that aren't threads (Queue, Board, New thread, a dropped tab). A lone split shows it only to carry or clear the sidebar toggle; otherwise just its drag strip. */
export function LeafBar({ children }: { children: ReactNode }) {
  const { isMulti, isFirst, leafId } = useSplit();
  const { hasTrigger, reservesToggle } = useToggleSlot(isFirst);
  if (!isMulti && !hasTrigger && !reservesToggle) return <DragStrip />;
  return (
    <TargetContextMenu target={{ leafId }} groups={SPLIT_MENU}>
      <TitleBar isFirst={isFirst}>
        <span className="flex min-w-0 flex-1 items-center gap-2 type-meta font-medium">{children}</span>
        <SplitControls />
      </TitleBar>
    </TargetContextMenu>
  );
}
