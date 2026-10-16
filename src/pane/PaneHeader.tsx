import { createContext, useContext, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExitFullscreen, Fullscreen, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ActionItems } from '../menus/ActionItems';
import { BROWSER_PANE_MENU, PANE_MENU } from '../menus/menus';
import { IconSwap, OverflowIcon, TooltipIconButton } from '../ui';
import type { PaneTabKind } from '../model';
import { useCaptionInset } from '../windowCaptions';
import { PANE_TABS } from './tabs';

interface Slots {
  title: HTMLElement | null;
  actions: HTMLElement | null;
  hasTitle: boolean;
  hasMenu: boolean;
  setTitle: (el: HTMLElement | null) => void;
  setActions: (el: HTMLElement | null) => void;
  claimTitle: (delta: 1 | -1) => void;
  claimMenu: (delta: 1 | -1) => void;
}

const SlotsContext = createContext<Slots | null>(null);

/** One pane: its header and its content share the header's slots. */
export function PaneSlots({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [titleClaims, setTitleClaims] = useState(0);
  const [menuClaims, setMenuClaims] = useState(0);
  const value = {
    title,
    actions,
    hasTitle: titleClaims > 0,
    hasMenu: menuClaims > 0,
    setTitle,
    setActions,
    claimTitle: (delta: 1 | -1) => setTitleClaims((n) => n + delta),
    claimMenu: (delta: 1 | -1) => setMenuClaims((n) => n + delta),
  };
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
  const hasOwnMenu = useContext(SlotsContext)?.hasMenu;
  const header = useRef<HTMLElement>(null);
  useCaptionInset(header);
  return (
    <header ref={header} data-pane-header onPointerDown={onDragStart} className="flex h-9 shrink-0 cursor-default items-center gap-0.5 pr-1.5 pl-3 select-none">
      <PaneTitleSlot>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="truncate type-meta font-medium">{title}</h2>
      </PaneTitleSlot>
      <PaneActionsSlot />
      {!!tabId && !hasOwnMenu && (
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
            <PaneMenuItems kind={kind} threadId={threadId} tabId={tabId} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <TooltipIconButton label={isExpanded ? 'Exit full size' : 'Expand'} hint={isExpanded ? 'Back beside the chat (Esc)' : 'Fill the thread, over the chat'} aria-pressed={isExpanded} onClick={onExpand} className="text-muted-foreground">
        <IconSwap id={isExpanded ? 'exit' : 'expand'}>{isExpanded ? <ExitFullscreen /> : <Fullscreen />}</IconSwap>
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

/** The slots alone, for a pane shown outside its card (in a split, popped out): what the pane put in its header still shows, and nothing at all when it put nothing there. */
export function PaneSlotBar() {
  return (
    <div data-pane-header className="flex h-9 shrink-0 items-center gap-0.5 pr-1.5 pl-3 not-has-[>*>*]:hidden">
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

/** The header's own ⋯ items, for a pane that has a ⋯ of its own (`usePaneMenu`) and puts them at the end of it. */
export function PaneMenuItems({ kind, threadId, tabId }: { kind: PaneTabKind; threadId: string; tabId: string }) {
  return (
    <>
      {kind === 'browser' && (
        <>
          <ActionItems target={{ threadId, tabId }} groups={BROWSER_PANE_MENU} menu="dropdown" />
          <DropdownMenuSeparator />
        </>
      )}
      <ActionItems target={{ threadId, tabId }} groups={PANE_MENU} menu="dropdown" />
    </>
  );
}

/** A pane with its own ⋯ in `PaneActions` takes over the header's, so there's only ever one; it ends with `PaneMenuItems`. */
export function usePaneMenu() {
  const claim = useContext(SlotsContext)?.claimMenu;
  useLayoutEffect(() => {
    if (!claim) return;
    claim(1);
    return () => claim(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claim's identity changes every render; the claim itself is once per mount
  }, []);
}

/** Its children sit in the pane header, left of ⋯, expand and close: the pane's own toolbar buttons. */
export function PaneActions({ children }: { children: ReactNode }) {
  const el = useContext(SlotsContext)?.actions;
  return el ? createPortal(children, el) : null;
}
