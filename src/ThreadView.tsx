import { useEffect, useMemo, useRef, useState } from 'react';
import { LimitChip } from './chat/LimitCard';
import { motion } from 'motion/react';
import { ChevronDown, SidebarRight, TextAlignLeft } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Pane, PaneTabKind, Thread } from './model';
import { PANE_TABS } from './pane/tabs';
import { layoutOf } from './store/panes';
import { BoundShortcut } from './Shortcut';
import { commandOf, paneCommand, listenKeydown } from './keymap';
import { isInside, PINNABLE_KINDS, setPinned, useHeaderPins, usePinDrop, type PinnableKind } from './pane/headerPins';
import { isWorking } from './agentPhase';
import { PipLayer } from './Browser';
import { RewindLayer } from './rewind/RewindLayer';
import { RewindMenuItems } from './rewind/RewindMenuItems';
import { ChatView } from './ChatView';
import { goalProgress, progressLabel } from './progress';
import { SidePane, useSplitTabIds } from './SidePane';
import { SplitControls } from './layout/SplitControls';
import { THREAD_ACTIONS_MENU, THREAD_HEADER_MENU } from './menus/menus';
import { ActionItems } from './menus/ActionItems';
import { TargetContextMenu } from './menus/TargetContextMenu';
import { useSplit } from './layout/SplitContext';
import { SummaryPanel } from './SummaryPanel';
import { TitleBar } from './TitleBar';
import { useDispatch, useHarnessSelector } from './store';
import { hasGoal } from './drift';
import { OverflowIcon, ProgressRing, TooltipIconButton } from './ui';
import { ThreadPrHoverCard } from './chat/RefHoverCard';
import { useSeen } from './notify/useSeen';

export function ThreadView({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const { isWide, isFocused } = useSplit();
  useSeen({ threadId: thread.id }, 'open-and-leave');
  const pane = useHarnessSelector((s) => s.panes.find((p) => p.threadId === thread.id));
  const isPaneOpen = !!pane?.isOpen;
  const summary = useSummaryState(isWide && isPaneOpen, isWide);
  const [isPaneTabOpen, setPaneTabOpen] = useState(false);
  const reveals = pane?.reveals ?? 0;
  const [seenReveals, setSeenReveals] = useState(reveals);
  if (reveals !== seenReveals) {
    setSeenReveals(reveals);
    if (!isWide) setPaneTabOpen(true);
  }
  const [isSummarySheetOpen, setSummarySheetOpen] = useState(false);
  const isPaneShown = isWide ? isPaneOpen : isPaneTabOpen;
  const inSplits = useSplitTabIds(thread.id);
  // Memoized by hand: the compiler leaves it inline, and a new array each render would give every pinned tab a new onToggle.
  const openKinds = useMemo(() => (isPaneShown && pane ? layoutOf(pane).columns.flat() : []), [isPaneShown, pane]);

  const toggleKind = (kind: PaneTabKind) => {
    const split = pane?.tabs.find((t) => t.kind === kind && inSplits.has(t.id));
    if (split) return dispatch({ type: 'go', view: { kind: 'tab', threadId: thread.id, tabId: split.id } });
    if (openKinds.includes(kind)) return dispatch({ type: 'pane-close-kind', threadId: thread.id, kind });
    dispatch({ type: 'pane-show-tab', threadId: thread.id, kind });
    if (!isWide) setPaneTabOpen(true);
  };
  usePaneShortcuts(isFocused, toggleKind);

  const header = (
    <ThreadHeader
      thread={thread}
      isSummaryOpen={isWide ? summary.isShown : isSummarySheetOpen}
      onToggleSummary={isWide ? summary.toggle : () => setSummarySheetOpen((o) => !o)}
      isPaneOpen={isPaneShown}
      onTogglePane={() => (isWide ? dispatch({ type: 'pane-toggle', threadId: thread.id }) : setPaneTabOpen((o) => !o))}
      openKinds={openKinds}
      onToggleKind={toggleKind}
    />
  );
  // The header belongs to the chat column, so the panes run to the top of the window beside it, like Claude's.
  const chat = (
    <div className="relative flex h-full min-w-0 flex-col [--chat-top:2.75rem]">
      {/* Opaque; the transcript starts below it and fades in through scroll-fade-y. */}
      <div className="absolute inset-x-0 top-0 z-20 bg-background">
        {header}
      </div>
      <div
        className={cn('grid min-h-0 flex-1 overflow-hidden', summary.animates && 'transition-[grid-template-columns] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none')}
        style={{ gridTemplateColumns: `minmax(0,1fr) ${isWide && summary.isDocked ? 'calc(300px + 0.75rem)' : '0px'}` }}
      >
        <ChatView thread={thread} />
        {isWide && <DockedSummary thread={thread} isOpen={summary.isDocked} animates={summary.animates} />}
      </div>
      {isWide && <FloatingSummary thread={thread} isOpen={summary.isFloating} animates={summary.animates} />}
      <div className="pointer-events-none absolute inset-x-0 top-1 bottom-36 z-30">
        <PipLayer thread={thread} />
      </div>
    </div>
  );
  // Narrow splits show the panes in place of the chat instead of beside it.
  const isChatHidden = !isWide && isPaneTabOpen;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      {isChatHidden && header}
      <div className="min-h-0 flex-1">
        {isWide || isChatHidden ? <SidePane thread={thread} pane={isChatHidden ? { ...(pane ?? noPane(thread.id)), isOpen: true } : (pane ?? noPane(thread.id))} chat={isChatHidden ? undefined : chat} /> : chat}
      </div>
      {!isWide && (
        <Sheet open={isSummarySheetOpen} onOpenChange={setSummarySheetOpen}>
          <SheetContent side="right" className="w-[300px] p-0 sm:max-w-[300px]">
            <SheetTitle className="sr-only">Thread summary</SheetTitle>
            <SummaryPanel
              thread={thread}
              // Room for the sheet's close button, which otherwise covers the summary's menu.
              className="h-full px-3 pt-10 pb-3"
              onPaneOpened={() => {
                setSummarySheetOpen(false);
                setPaneTabOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function noPane(threadId: string): Pane {
  return { threadId, isOpen: false, tabs: [], activeTab: '' };
}

/** Each pane's toggle command (mod Alt + its letter by default) toggles that pane in the focused split. */
function usePaneShortcuts(isFocused: boolean, onToggle: (kind: PaneTabKind) => void) {
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  useEffect(() => {
    if (!isFocused) return;
    const onKey = (e: KeyboardEvent) => {
      const command = commandOf(e, PINNABLE_KINDS.map(paneCommand));
      if (!command) return;
      const kind = PINNABLE_KINDS[PINNABLE_KINDS.map(paneCommand).indexOf(command)];
      e.preventDefault();
      toggle.current(kind);
    };
    return listenKeydown(onKey);
  }, [isFocused]);
}

/**
 * While the side pane is open the docked summary hides and the toggle opens a floating one instead.
 * Closing the pane docks the summary if the floating one was open, otherwise restores the docked state from before.
 * Only the summary's own toggle animates it; the pane opening or closing moves it in one step.
 */
function useSummaryState(isPaneOpen: boolean, isWide: boolean) {
  const [isDockedOpen, setDockedOpen] = useState(isWide);
  const [isFloatingOpen, setFloatingOpen] = useState(false);
  const [wasPaneOpen, setWasPaneOpen] = useState(isPaneOpen);
  const [animates, setAnimates] = useState(false);
  if (isPaneOpen !== wasPaneOpen) {
    setWasPaneOpen(isPaneOpen);
    setAnimates(false);
    if (!isPaneOpen && isFloatingOpen) setDockedOpen(true);
    setFloatingOpen(false);
  }

  const isDocked = !isPaneOpen && isDockedOpen;
  const isFloating = isPaneOpen && isFloatingOpen;
  const toggle = () => {
    setAnimates(true);
    if (isPaneOpen) setFloatingOpen((o) => !o);
    else setDockedOpen((o) => !o);
  };
  return { isDocked, isFloating, isShown: isDocked || isFloating, animates, toggle };
}

/** The summary column grows from the right edge while the card itself rises out of the header toggle above it. */
function DockedSummary({ thread, isOpen, animates }: { thread: Thread; isOpen: boolean; animates: boolean }) {
  const shown = useHeldWhileClosed(thread, isOpen);
  return (
    // Above the header's blur edge, which is for the scrolling chat only; the header's own controls stay clickable past it.
    <div className="pointer-events-none relative z-30 min-w-0 overflow-hidden pt-(--chat-top)" inert={!isOpen || undefined}>
      <div
        className={cn(
          'pointer-events-auto h-full w-[300px] origin-top-right pr-3 pb-3',
          isOpen ? 'scale-100 opacity-100' : 'scale-[0.97] opacity-0',
          animates && ['transition-[opacity,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity', isOpen ? 'duration-200' : 'duration-150'],
        )}
      >
        <SummaryPanel thread={shown} className="h-full" />
      </div>
    </div>
  );
}

function FloatingSummary({ thread, isOpen, animates }: { thread: Thread; isOpen: boolean; animates: boolean }) {
  const shown = useHeldWhileClosed(thread, isOpen);
  return (
    <div
      inert={!isOpen || undefined}
      className={cn(
        'pointer-events-none absolute top-11 right-3 bottom-3 z-40 flex w-[300px] flex-col origin-top-right',
        isOpen ? 'scale-100 opacity-100' : 'scale-[0.97] opacity-0',
        animates && ['transition-[opacity,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity', isOpen ? 'duration-200' : 'duration-150'],
      )}
    >
      {/* The wrapper spans to the bottom only to cap the card's height; it lets clicks through to the chat. */}
      <SummaryPanel thread={shown} isFloating className={cn('max-h-full', isOpen && 'pointer-events-auto')} />
    </div>
  );
}

/** Both summaries stay mounted so they can fade; the closed one keeps the thread as it was, so a streaming agent doesn't re-render it. */
function useHeldWhileClosed(thread: Thread, isOpen: boolean) {
  const [held, setHeld] = useState(thread);
  if (isOpen && held !== thread) setHeld(thread);
  return isOpen ? thread : held;
}

function ThreadHeader({
  thread,
  isSummaryOpen,
  onToggleSummary,
  isPaneOpen,
  onTogglePane,
  openKinds,
  onToggleKind,
}: {
  thread: Thread;
  isSummaryOpen: boolean;
  onToggleSummary: () => void;
  isPaneOpen: boolean;
  onTogglePane: () => void;
  /** The panes on screen right now. */
  openKinds: PaneTabKind[];
  onToggleKind: (kind: PaneTabKind) => void;
}) {
  const { isFirst, isMulti, leafId } = useSplit();
  const progress = goalProgress(thread);
  const header = useRef<HTMLElement>(null);
  const pinDrop = usePinDrop(header);

  return (
    <TargetContextMenu target={{ leafId }} groups={THREAD_HEADER_MENU}>
      <TitleBar ref={header} isFirst={isFirst} isMulti={isMulti} data-pin-drop className={cn('@container transition-colors duration-150', pinDrop.isOver && 'bg-accent/40')}>
        <ThreadMenu thread={thread} />
        <LimitChip thread={thread} />
        {thread.prs.map((pr) => (
          <ThreadPrHoverCard key={pr.number} thread={thread} pr={pr}>
            <Badge variant="secondary" tabIndex={0} aria-label={`#${pr.number}: ${pr.title}`} className="hidden @2xl:inline-flex">
              #{pr.number}
            </Badge>
          </ThreadPrHoverCard>
        ))}
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Thread summary" aria-pressed={isSummaryOpen} onClick={onToggleSummary} className={cn('gap-1.5 px-2 text-muted-foreground', isSummaryOpen && 'bg-accent text-foreground')}>
              {hasGoal(thread) ? (
                <>
                  <ProgressRing met={progress.met} total={progress.total} slot={thread.line} size={14} isWorking={isWorking(thread)} />
                  <span className="tabular">{progressLabel(progress)}</span>
                </>
              ) : (
                <TextAlignLeft className="size-4" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isSummaryOpen ? 'Hide the summary' : 'Show the summary'}</TooltipContent>
        </Tooltip>
        <SplitControls />
        <HeaderPins openKinds={openKinds} onToggle={onToggleKind} drop={pinDrop} />
        <TooltipIconButton
          label={isPaneOpen ? 'Hide the panes' : 'Show the panes'}
          aria-pressed={isPaneOpen}
          onClick={onTogglePane}
          className={cn('text-muted-foreground', isPaneOpen && 'bg-accent text-foreground')}
        >
          <SidebarRight />
        </TooltipIconButton>
        <PanesMenu openKinds={openKinds} onToggle={onToggleKind} />
        <RewindLayer thread={thread} />
      </TitleBar>
    </TargetContextMenu>
  );
}

/** The title opens the thread's actions, like Claude's: the same registry actions as the header's right-click menu, plus rewind's undo and fork comparisons. */
function ThreadMenu({ thread }: { thread: Thread }) {
  return (
    <DropdownMenu>
      <h1 className="flex min-w-0">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 shrink gap-1 px-1.5">
            <span className="truncate type-title">{thread.title}</span>
            <ChevronDown aria-hidden className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </h1>
      <DropdownMenuContent align="start" className="w-60">
        <ActionItems target={{ threadId: thread.id }} groups={THREAD_ACTIONS_MENU} menu="dropdown" />
        <RewindMenuItems thread={thread} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pinned panes as toggles, pressed while open; while a pane is dragged over the header, a slot shows where it would pin. */
function HeaderPins({ openKinds, onToggle, drop }: { openKinds: PaneTabKind[]; onToggle: (kind: PaneTabKind) => void; drop: ReturnType<typeof usePinDrop> }) {
  const pins = useHeaderPins();
  return (
    <div className="hidden items-center gap-0.5 @xl:flex">
      {pins.map((kind) => (
        <PinnedTab key={kind} kind={kind} isOpen={openKinds.includes(kind)} onToggle={() => onToggle(kind)} />
      ))}
      {drop.isDragging && <span aria-hidden className={cn('size-7 rounded-md border border-dashed border-foreground/25 transition-colors', drop.isOver && 'border-foreground/50 bg-accent')} />}
    </div>
  );
}

function PinnedTab({ kind, isOpen, onToggle }: { kind: PinnableKind; isOpen: boolean; onToggle: () => void }) {
  const { title, icon: Icon } = PANE_TABS[kind];
  const [drag, setDrag] = useState<'idle' | 'inside' | 'outside'>('idle');
  // Motion still fires click on the release that ends a drag.
  const wasDragged = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  // A rect check, not hit-testing: the dragged icon is under the pointer and still inside the header's DOM.
  const isInHeader = (x: number, y: number) => {
    const header = ref.current?.closest('[data-pin-drop]');
    return !!header && isInside(header, x, y);
  };
  return (
    <motion.div
      ref={ref}
      drag
      dragSnapToOrigin
      onDragStart={() => {
        wasDragged.current = true;
        setDrag('inside');
      }}
      onDrag={(_, info) => setDrag(isInHeader(info.point.x, info.point.y) ? 'inside' : 'outside')}
      onDragEnd={(_, info) => {
        setDrag('idle');
        if (!isInHeader(info.point.x, info.point.y)) setPinned(kind, false);
      }}
      whileDrag={{ scale: 1.1, zIndex: 50 }}
      className={cn('rounded-md transition-opacity', drag !== 'idle' && 'bg-popover shadow-float', drag === 'outside' && 'opacity-50')}
    >
      <TooltipIconButton
        label={title}
        hint={
          <>
            {isOpen ? `Close ${title}.` : `Open ${title} beside the chat.`} <BoundShortcut command={paneCommand(kind)} />
          </>
        }
        aria-pressed={isOpen}
        onClick={() => {
          if (wasDragged.current) return void (wasDragged.current = false);
          onToggle();
        }}
        className={cn('text-muted-foreground', isOpen && 'bg-accent text-foreground')}
      >
        <Icon />
      </TooltipIconButton>
    </motion.div>
  );
}

/** Every pane, open or closed with its shortcut, then which of them sit in the header. */
function PanesMenu({ openKinds, onToggle }: { openKinds: PaneTabKind[]; onToggle: (kind: PaneTabKind) => void }) {
  const pins = useHeaderPins();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Panes" className="text-muted-foreground">
              <OverflowIcon vertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Panes</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Panes</DropdownMenuLabel>
          {PINNABLE_KINDS.map((kind) => {
            const { title, icon: Icon } = PANE_TABS[kind];
            return (
              // No check column: the label's strength says the pane is open, so the shortcut keys sit at the item's right padding.
              <DropdownMenuCheckboxItem key={kind} checked={openKinds.includes(kind)} onCheckedChange={() => onToggle(kind)} className="pr-1.5 text-muted-foreground data-[state=checked]:text-foreground *:data-[slot=dropdown-menu-checkbox-item-indicator]:hidden">
                <Icon />
                {title}
                <DropdownMenuShortcut>
                  <BoundShortcut command={paneCommand(kind)} />
                </DropdownMenuShortcut>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Pin to header</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            {PINNABLE_KINDS.map((kind) => {
              const { title, icon: Icon } = PANE_TABS[kind];
              return (
                <DropdownMenuCheckboxItem key={kind} checked={pins.includes(kind)} onCheckedChange={(checked) => setPinned(kind, checked)} onSelect={(e) => e.preventDefault()}>
                  <Icon />
                  {title}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
