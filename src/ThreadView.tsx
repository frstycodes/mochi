import { useEffect, useRef, useState } from 'react';
import { LimitChip } from './chat/LimitCard';
import { motion } from 'motion/react';
import { ChevronDown, Laptop, SidebarRight, TextalignLeft } from 'reicon-react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Pane, PaneTabKind, Thread } from './model';
import { PANE_TABS } from './pane/tabs';
import { isInside, PINNABLE_KINDS, setPinned, useHeaderPins, usePinDrop } from './pane/headerPins';
import { AgentLoader } from './AgentLoader';
import { agentPhase, isWorking } from './agentPhase';
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
import { useHarness } from './store';
import { hasGoal } from './drift';
import { startRename, useIsRenaming } from './rename';
import { OverflowIcon, ProgressRing, TooltipIconButton } from './ui';
import { ThreadPrHoverCard } from './chat/RefHoverCard';
import { BranchIcon, BranchName } from './git/BranchLabel';

const PANE_ANIMATION_MS = 260;
const DEFAULT_PANE_PCT = 36;

export function ThreadView({ thread }: { thread: Thread }) {
  const { state, dispatch } = useHarness();
  const { isWide } = useSplit();
  const pane = state.panes.find((p) => p.threadId === thread.id);
  const isPaneOpen = !!pane?.isOpen;
  const summary = useSummaryState(isWide && isPaneOpen, isWide);
  const [isPaneTabOpen, setPaneTabOpen] = useState(false);
  const [isSummarySheetOpen, setSummarySheetOpen] = useState(false);
  const isPaneShown = isWide ? isPaneOpen : isPaneTabOpen;

  const inSplits = useSplitTabIds(thread.id);
  const showTab = (kind: PaneTabKind) => {
    const split = pane?.tabs.find((t) => t.kind === kind && inSplits.has(t.id));
    if (split) return dispatch({ type: 'go', view: { kind: 'tab', threadId: thread.id, tabId: split.id } });
    dispatch({ type: 'pane-show-tab', threadId: thread.id, kind });
    if (!isWide) setPaneTabOpen(true);
  };

  // Narrow splits show the side pane as a tab in place of the chat instead of docking it.
  const body =
    !isWide && isPaneTabOpen ? (
      <div className="min-h-0 flex-1">{pane ? <SidePane thread={thread} pane={pane} /> : <NoPaneYet thread={thread} />}</div>
    ) : (
      <div
        className="grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ gridTemplateColumns: `minmax(0,1fr) ${isWide && summary.isDocked ? 'calc(300px + 0.75rem)' : '0px'}` }}
      >
        <ChatView thread={thread} />
        {isWide && <DockedSummary thread={thread} isOpen={summary.isDocked} />}
      </div>
    );

  const chat = (
    <div className="relative flex h-full min-w-0 flex-col">
      <ThreadHeader
        thread={thread}
        isSummaryOpen={isWide ? summary.isShown : isSummarySheetOpen}
        onToggleSummary={isWide ? summary.toggle : () => setSummarySheetOpen((o) => !o)}
        isPaneOpen={isPaneShown}
        onTogglePane={() => (isWide ? dispatch({ type: 'pane-toggle', threadId: thread.id }) : setPaneTabOpen((o) => !o))}
        shownKind={isPaneShown && pane ? shownTab(pane)?.kind : undefined}
        onShowTab={showTab}
      />
      {body}
      {isWide && <FloatingSummary thread={thread} isOpen={summary.isFloating} />}
      <div className="pointer-events-none absolute inset-x-0 top-12 bottom-36 z-30">
        <PipLayer thread={thread} />
      </div>
    </div>
  );

  if (!isWide)
    return (
      <div className="h-full min-h-0">
        {chat}
        <Sheet open={isSummarySheetOpen} onOpenChange={setSummarySheetOpen}>
          <SheetContent side="right" className="w-[300px] p-0 sm:max-w-[300px]">
            <SheetTitle className="sr-only">Thread summary</SheetTitle>
            <SummaryPanel
              thread={thread}
              // Room for the sheet's close button, which otherwise covers the summary's menu.
              className="h-full pt-8"
              onPaneOpened={() => {
                setSummarySheetOpen(false);
                setPaneTabOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      </div>
    );

  return <DockedLayout chat={chat} thread={thread} pane={pane} isPaneOpen={isPaneOpen} />;
}

/**
 * While the side pane is open the docked summary hides and the toggle opens a floating one instead.
 * Closing the pane docks the summary if the floating one was open, otherwise restores the docked state from before.
 */
function useSummaryState(isPaneOpen: boolean, isWide: boolean) {
  const [isDockedOpen, setDockedOpen] = useState(isWide);
  const [isFloatingOpen, setFloatingOpen] = useState(false);
  const [wasPaneOpen, setWasPaneOpen] = useState(isPaneOpen);
  if (isPaneOpen !== wasPaneOpen) {
    setWasPaneOpen(isPaneOpen);
    if (!isPaneOpen && isFloatingOpen) setDockedOpen(true);
    setFloatingOpen(false);
  }

  const isDocked = !isPaneOpen && isDockedOpen;
  const isFloating = isPaneOpen && isFloatingOpen;
  const toggle = () => (isPaneOpen ? setFloatingOpen((o) => !o) : setDockedOpen((o) => !o));
  return { isDocked, isFloating, isShown: isDocked || isFloating, toggle };
}

/** The summary column grows from the right edge while the card itself rises out of the header toggle above it. */
function DockedSummary({ thread, isOpen }: { thread: Thread; isOpen: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden" inert={!isOpen || undefined}>
      <div
        className={cn(
          'h-full w-[300px] origin-top-right pr-3 pb-3 transition-[opacity,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity',
          isOpen ? 'scale-100 opacity-100 duration-200' : 'scale-[0.97] opacity-0 duration-150',
        )}
      >
        <SummaryPanel thread={thread} className="h-full rounded-xl border bg-card" />
      </div>
    </div>
  );
}

function FloatingSummary({ thread, isOpen }: { thread: Thread; isOpen: boolean }) {
  return (
    <div
      inert={!isOpen || undefined}
      className={cn(
        'pointer-events-none absolute top-11 right-3 bottom-3 z-40 flex w-[300px] flex-col origin-top-right transition-[opacity,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity',
        isOpen ? 'scale-100 opacity-100 duration-200' : 'scale-[0.97] opacity-0 duration-150',
      )}
    >
      {/* The wrapper spans to the bottom only to cap the card's height; it lets clicks through to the chat. */}
      <SummaryPanel thread={thread} className={cn('max-h-full rounded-xl bg-popover shadow-float', isOpen && 'pointer-events-auto')} />
    </div>
  );
}

function DockedLayout({ chat, thread, pane, isPaneOpen }: { chat: React.ReactNode; thread: Thread; pane?: Pane; isPaneOpen: boolean }) {
  const panel = useRef<PanelImperativeHandle | null>(null);
  const lastSize = useRef(DEFAULT_PANE_PCT);
  const [isAnimating, setAnimating] = useState(false);
  const isMounted = useRef(false);

  useEffect(() => {
    const p = panel.current;
    // Mounting (opening a thread, a pinned page mounting beside the current one) never animates the pane: the swiped-in preview already shows it at full size.
    const isToggle = isMounted.current;
    isMounted.current = true;
    if (!p || p.isCollapsed() === !isPaneOpen) return;
    const target = `${lastSize.current}%`;
    if (isPaneOpen) {
      p.expand();
      p.resize(target);
    } else {
      // Read the size from the layout before collapsing: onResize measures the DOM, so it reports widths mid-transition.
      lastSize.current = p.getSize().asPercentage;
      p.collapse();
    }
    if (!isToggle) return;
    setAnimating(true);
    const t = window.setTimeout(() => setAnimating(false), PANE_ANIMATION_MS);
    return () => window.clearTimeout(t);
  }, [isPaneOpen]);

  return (
    <ResizablePanelGroup orientation="horizontal" className={cn('h-full', isAnimating && 'pane-animating')}>
      <ResizablePanel id="chat" minSize="35%">
        {chat}
      </ResizablePanel>
      <ResizableHandle className={cn('bg-transparent hover:bg-border', !isPaneOpen && 'pointer-events-none')} />
      <ResizablePanel
        id="pane"
        panelRef={panel}
        collapsible
        collapsedSize="0%"
        minSize="25%"
        defaultSize={isPaneOpen ? `${DEFAULT_PANE_PCT}%` : '0%'}
      >
        <div className={cn('h-full transition-opacity duration-200', isPaneOpen ? 'opacity-100' : 'opacity-0')} inert={!isPaneOpen || undefined}>
          {pane ? <SidePane thread={thread} pane={pane} /> : <NoPaneYet thread={thread} />}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** The side pane's active tab, as SidePane resolves it. */
function shownTab(pane: Pane) {
  const docked = pane.tabs.filter((t) => !t.isPopped);
  return docked.find((t) => t.id === pane.activeTab) ?? docked[0];
}

function NoPaneYet({ thread }: { thread: Thread }) {
  const { dispatch } = useHarness();
  return (
    <div className="flex h-full items-center justify-center bg-sidebar p-6">
      <Button onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'new' })}>Open a tab</Button>
    </div>
  );
}

function ThreadHeader({
  thread,
  isSummaryOpen,
  onToggleSummary,
  isPaneOpen,
  onTogglePane,
  shownKind,
  onShowTab,
}: {
  thread: Thread;
  isSummaryOpen: boolean;
  onToggleSummary: () => void;
  isPaneOpen: boolean;
  onTogglePane: () => void;
  /** The pane tab on screen right now, if the pane is shown. */
  shownKind?: PaneTabKind;
  onShowTab: (kind: PaneTabKind) => void;
}) {
  const { isFirst, leafId } = useSplit();
  const progress = goalProgress(thread);
  const header = useRef<HTMLElement>(null);
  const pinDrop = usePinDrop(header);

  return (
    <TargetContextMenu target={{ leafId }} groups={THREAD_HEADER_MENU}>
      <TitleBar ref={header} isFirst={isFirst} data-pin-drop className={cn('@container transition-colors duration-150', pinDrop.isOver && 'bg-accent/40')}>
        <AgentLoader phase={agentPhase(thread)} className="-mx-1 size-7 text-muted-foreground" />
        <DeviceIndicator />
        <ThreadMenu thread={thread} />
        <LimitChip thread={thread} />
        {!!thread.repo && (
          <span className="hidden min-w-0 items-center gap-1 type-caption text-subtle-foreground @2xl:flex">
            <BranchIcon repo={thread.repo} />
            <BranchName repo={thread.repo} />
          </span>
        )}
        {thread.prs.map((pr) => (
          <ThreadPrHoverCard key={pr.number} thread={thread} pr={pr}>
            <Badge variant="secondary" tabIndex={0} aria-label={`#${pr.number}: ${pr.title}`} className="hidden @xl:inline-flex">
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
                <TextalignLeft className="size-4" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isSummaryOpen ? 'Hide the summary' : 'Show the summary'}</TooltipContent>
        </Tooltip>
        <SplitControls />
        <HeaderPins shownKind={shownKind} onToggle={(kind) => (kind === shownKind ? onTogglePane() : onShowTab(kind))} drop={pinDrop} />
        <TooltipIconButton
          label={isPaneOpen ? 'Hide the side pane' : 'Show the side pane'}
          aria-pressed={isPaneOpen}
          onClick={onTogglePane}
          className={cn('text-muted-foreground', isPaneOpen && 'bg-accent text-foreground')}
        >
          <SidebarRight />
        </TooltipIconButton>
        <PinsMenu />
        <RewindLayer thread={thread} />
      </TitleBar>
    </TargetContextMenu>
  );
}

/** Where the agent runs. Only this computer exists yet, so it states that rather than offering choices that do nothing. */
function DeviceIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label="Runs on this computer" className="-mr-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground">
          <Laptop className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="block font-medium">Runs on this computer</span>
        <span className="block opacity-80">The agent works in this thread's folder on your machine</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The title opens the thread's actions, like Claude's: the same registry actions as the header's right-click menu, plus rewind's undo and fork comparisons. */
function ThreadMenu({ thread }: { thread: Thread }) {
  const isRenaming = useIsRenaming(thread.id);
  if (isRenaming) return <TitleField thread={thread} />;
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

/** The header title as a field: Enter or leaving it saves, Esc keeps the old title. */
function TitleField({ thread }: { thread: Thread }) {
  const { dispatch } = useHarness();
  const ref = useRef<HTMLInputElement>(null);
  // After the menu that started the rename has closed and handed focus back.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const isCancelled = useRef(false);
  const save = (title: string) => {
    startRename(null);
    if (!isCancelled.current && title.trim() && title.trim() !== thread.title) dispatch({ type: 'rename', threadId: thread.id, title: title.trim() });
  };
  return (
    <h1 className="flex min-w-0 flex-1">
      <Input
        ref={ref}
        defaultValue={thread.title}
        aria-label="Thread title"
        maxLength={120}
        onBlur={(e) => save(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key !== 'Escape') return;
          isCancelled.current = true;
          startRename(null);
        }}
        className="h-7 max-w-md px-1.5 type-title"
      />
    </h1>
  );
}

/** Pinned side pane tabs; while a pane tab is dragged over the header, a slot shows where it lands. */
function HeaderPins({ shownKind, onToggle, drop }: { shownKind?: PaneTabKind; onToggle: (kind: PaneTabKind) => void; drop: ReturnType<typeof usePinDrop> }) {
  const pins = useHeaderPins();
  return (
    <div className="hidden items-center gap-0.5 @md:flex">
      {pins.map((kind) => (
        <PinnedTab key={kind} kind={kind} isShown={kind === shownKind} onToggle={() => onToggle(kind)} />
      ))}
      {drop.isDragging && <span aria-hidden className={cn('size-7 rounded-md border border-dashed border-foreground/25 transition-colors', drop.isOver && 'border-foreground/50 bg-accent')} />}
    </div>
  );
}

function PinnedTab({ kind, isShown, onToggle }: { kind: PaneTabKind; isShown: boolean; onToggle: () => void }) {
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
        hint={isShown ? 'Hide the side pane. Drag off the header to unpin.' : `Open ${title} in the side pane. Drag off the header to unpin.`}
        aria-pressed={isShown}
        onClick={() => {
          if (wasDragged.current) return void (wasDragged.current = false);
          onToggle();
        }}
        className={cn('text-muted-foreground', isShown && 'bg-accent text-foreground')}
      >
        <Icon />
      </TooltipIconButton>
    </motion.div>
  );
}

/** Which pane tabs sit in the header; thread actions live under the title. */
function PinsMenu() {
  const pins = useHeaderPins();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Pin to header" className="text-muted-foreground">
              <OverflowIcon vertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Pin to header</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Pin to header</DropdownMenuLabel>
          {PINNABLE_KINDS.map((kind) => {
            const { title, icon: Icon } = PANE_TABS[kind];
            return (
              <DropdownMenuCheckboxItem key={kind} checked={pins.includes(kind)} onCheckedChange={(checked) => setPinned(kind, checked)} onSelect={(e) => e.preventDefault()}>
                <Icon />
                {title}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
