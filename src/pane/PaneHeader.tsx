import { createContext, useContext, useLayoutEffect, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExitFullscreen, Fullscreen, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ActionItems } from '../menus/ActionItems';
import { PANE_MENU } from '../menus/menus';
import { OverflowIcon, TooltipIconButton } from '../ui';
import type { PaneTabKind } from '../model';
import { PANE_TABS } from './tabs';

interface Slots {
  title: HTMLElement | null;
  actions: HTMLElement | null;
  hasTitle: boolean;
  setTitle: (el: HTMLElement | null) => void;
  setActions: (el: HTMLElement | null) => void;
  claimTitle: (delta: 1 | -1) => void;
}

const SlotsContext = createContext<Slots | null>(null);

/** One pane: its header and its content share the header's slots. */
export function PaneSlots({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [titleClaims, setTitleClaims] = useState(0);
  const value = { title, actions, hasTitle: titleClaims > 0, setTitle, setActions, claimTitle: (delta: 1 | -1) => setTitleClaims((n) => n + delta) };
  return <SlotsContext.Provider value={value}>{children}</SlotsContext.Provider>;
}

/**
 * A pane's header: its name (or what the pane puts there with `PaneTitle`, like its own tabs), what it puts in `PaneActions`,
 * then ⋯, expand and close. Contents fill the slots from anywhere in their tree, so a toolbar moves into the header without the
 * shell knowing what's in it. Pressing on empty header space starts a drag of the pane.
 */
export function PaneHeader({
  kind,
  threadId,
  tabId,
  isExpanded,
  onExpand,
  onClose,
  onDragStart,
}: {
  kind: PaneTabKind;
  threadId: string;
  tabId?: string;
  isExpanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onDragStart: (e: PointerEvent) => void;
}) {
  const { title, icon: Icon } = PANE_TABS[kind];
  return (
    <header data-pane-header onPointerDown={onDragStart} className="flex h-10 shrink-0 cursor-default items-center gap-0.5 pr-1 pl-3 select-none">
      <PaneTitleSlot>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="truncate type-meta font-medium">{title}</h2>
      </PaneTitleSlot>
      <PaneActionsSlot />
      {!!tabId && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`More ${title} actions`} className="text-muted-foreground">
                  <OverflowIcon />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
            <ActionItems target={{ threadId, tabId }} groups={PANE_MENU} menu="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <TooltipIconButton label={isExpanded ? 'Exit full size' : 'Expand'} hint={isExpanded ? 'Back beside the chat (Esc)' : 'Fill the thread, over the chat'} aria-pressed={isExpanded} onClick={onExpand} className="text-muted-foreground">
        {isExpanded ? <ExitFullscreen /> : <Fullscreen />}
      </TooltipIconButton>
      <TooltipIconButton label={`Close ${title}`} hint="It opens again where you left it" onClick={onClose} className="text-muted-foreground">
        <X />
      </TooltipIconButton>
    </header>
  );
}

/** Where `PaneTitle` lands; shows `children` (the pane's name) while nothing claims it. Popped-out panes and splits place their own. */
export function PaneTitleSlot({ children }: { children?: ReactNode }) {
  const slots = useContext(SlotsContext)!;
  return (
    <div ref={slots.setTitle} className="flex h-full min-w-0 flex-1 items-center gap-1.5">
      {!slots.hasTitle && children}
    </div>
  );
}

export function PaneActionsSlot() {
  return <div ref={useContext(SlotsContext)!.setActions} className="flex shrink-0 items-center gap-0.5" />;
}

/** The slots alone, for a pane shown outside its card (in a split, popped out): what the pane put in its header still shows. */
export function PaneSlotBar() {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 pr-1 pl-3">
      <PaneTitleSlot />
      <PaneActionsSlot />
    </div>
  );
}

/** Its children take the pane header's title, in place of the pane's name: the pane's own tabs, a file name. */
export function PaneTitle({ children }: { children: ReactNode }) {
  const slots = useContext(SlotsContext);
  const claim = slots?.claimTitle;
  useLayoutEffect(() => {
    if (!claim) return;
    claim(1);
    return () => claim(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claim's identity changes every render; the claim itself is once per mount
  }, []);
  return slots?.title ? createPortal(children, slots.title) : null;
}

/** Its children sit in the pane header, left of ⋯, expand and close: the pane's own toolbar buttons. */
export function PaneActions({ children }: { children: ReactNode }) {
  const el = useContext(SlotsContext)?.actions;
  return el ? createPortal(children, el) : null;
}
