import { useEffect, useRef, useState } from 'react';
import { BranchUp, SidebarRight } from 'reicon-react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Pane, Thread } from './model';
import { AgentLoader } from './AgentLoader';
import { agentPhase, isWorking } from './agentPhase';
import { PipLayer } from './Browser';
import { RewindLayer } from './rewind/RewindLayer';
import { RewindMenuItems } from './rewind/RewindMenuItems';
import { ChatView } from './ChatView';
import { progressAt } from './progress';
import { SidePane } from './SidePane';
import { SplitControls } from './layout/SplitControls';
import { THREAD_ACTIONS_MENU, THREAD_HEADER_MENU } from './menus/menus';
import { ActionItems } from './menus/ActionItems';
import { TargetContextMenu } from './menus/TargetContextMenu';
import { useSplit } from './layout/SplitContext';
import { SummaryPanel } from './SummaryPanel';
import { TOGGLE_RESERVE, useToggleSlot } from './SidebarToggle';
import { useHarness } from './store';
import { OverflowIcon, ProgressRing } from './ui';

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
        isPaneOpen={isWide ? isPaneOpen : isPaneTabOpen}
        onTogglePane={() => (isWide ? dispatch({ type: 'pane-toggle', threadId: thread.id }) : setPaneTabOpen((o) => !o))}
      />
      {body}
      {isWide && <FloatingSummary thread={thread} isOpen={summary.isFloating} />}
      <div className="pointer-events-none absolute inset-x-0 top-12 bottom-36 z-30 overflow-hidden">
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
            <SummaryPanel thread={thread} className="h-full" />
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
    // Mounting (opening a thread, a Stage swipe landing) never animates the pane: the swiped-in preview already shows it at full size.
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
}: {
  thread: Thread;
  isSummaryOpen: boolean;
  onToggleSummary: () => void;
  isPaneOpen: boolean;
  onTogglePane: () => void;
}) {
  const { state } = useHarness();
  const { isFirst, leafId } = useSplit();
  const { pct } = progressAt(thread, state.now, true);
  const { hasTrigger, reservesToggle } = useToggleSlot(isFirst);

  return (
    <TargetContextMenu target={{ leafId }} groups={THREAD_HEADER_MENU}>
      <header className={cn('app-drag @container flex h-11 shrink-0 items-center gap-2 px-3', reservesToggle && TOGGLE_RESERVE)}>
        {hasTrigger && <SidebarTrigger className="-ml-1" />}
        <AgentLoader phase={agentPhase(thread)} className="-mx-1 size-7 text-muted-foreground" />
        <h1 className="min-w-0 truncate type-title">{thread.title}</h1>
        {!!thread.repo && (
          <span className="hidden min-w-0 items-center gap-1 truncate font-mono type-caption text-subtle-foreground @2xl:flex">
            <BranchUp className="size-3.5 shrink-0" />
            {thread.repo.branch}
          </span>
        )}
        {thread.prs.map((pr) => (
          <Badge key={pr.number} variant="secondary" title={pr.title} className="hidden @xl:inline-flex">
            #{pr.number}
          </Badge>
        ))}
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Thread summary" aria-pressed={isSummaryOpen} onClick={onToggleSummary} className={cn('gap-1.5 px-2 text-muted-foreground', isSummaryOpen && 'bg-accent text-foreground')}>
              <ProgressRing pct={pct} slot={thread.line} size={14} isWorking={isWorking(thread)} />
              <span className="tabular">{Math.round(pct * 100)}%</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isSummaryOpen ? 'Hide the summary' : 'Show the summary'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={isPaneOpen ? 'Hide the side pane' : 'Show the side pane'} aria-pressed={isPaneOpen} onClick={onTogglePane} className={cn('text-muted-foreground', isPaneOpen && 'bg-accent text-foreground')}>
              <SidebarRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPaneOpen ? 'Hide the side pane' : 'Show the side pane'}</TooltipContent>
        </Tooltip>
        <ThreadMenu thread={thread} />
        <RewindLayer thread={thread} />
        <SplitControls />
      </header>
    </TargetContextMenu>
  );
}

/** The same registry actions as the header's right-click menu, plus rewind's undo and fork comparisons. */
function ThreadMenu({ thread }: { thread: Thread }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Thread actions" className="text-muted-foreground">
          <OverflowIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <ActionItems target={{ threadId: thread.id }} groups={THREAD_ACTIONS_MENU} menu="dropdown" />
        <RewindMenuItems thread={thread} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
