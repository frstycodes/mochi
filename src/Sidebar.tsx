import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Reorder, animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { useTheme } from 'next-themes';
import { Archive, BranchUp, ChatRound, ChevronRight, Edit, Flash, Inbox, Monitor, Moon, More, Pause, Play, Refresh, Route, Search, Sun, Undo } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SPACES, type PullRequest, type Thread } from './model';
import { SidebarResizer } from './SidebarResizer';
import { useSettle } from './useSettle';
import { useHarness, useSpace, useSpaceQueue, useSpaceThreads, useView, type View } from './store';
import { duration, progressAt } from './progress';
import { ProgressRing, SpaceIcon } from './ui';

export function AppSidebar({ onSearch, collapsible, width, onResize }: { onSearch: () => void; collapsible?: 'offcanvas' | 'icon' | 'none'; width?: number; onResize?: (px: number) => void }) {
  const { state, dispatch } = useHarness();
  const index = SPACES.findIndex((s) => s.id === state.spaceId);
  const swipe = useSpaceSwipe(index, (step) => dispatch({ type: 'space', id: SPACES[index + step].id }));

  return (
    <Sidebar onWheel={swipe.onWheel} collapsible={collapsible}>
      <SpaceHeader />
      <SidebarContent ref={swipe.ref} className="relative overflow-x-hidden">
        {/* Every space stays mounted so neighbours show mid-swipe; window to index ± 1 if the space count grows. */}
        {SPACES.map((s, i) => (
          <SpacePanel key={s.id} pos={swipe.pos} index={i} isCurrent={i === index}>
            <SpaceNav spaceId={s.id} onSearch={onSearch} />
          </SpacePanel>
        ))}
      </SidebarContent>
      <SpaceFooter />
      {width !== undefined && !!onResize && <SidebarResizer width={width} onCommit={onResize} />}
    </Sidebar>
  );
}

const PEEK_CLOSE_DELAY = 240;

/** Arc-style: with the sidebar collapsed, resting on the left edge slides it back in as a floating panel. */
export function SidebarPeek({ onSearch }: { onSearch: () => void }) {
  const { state, isMobile } = useSidebar();
  const [isOpen, setOpen] = useState(false);
  const closeTimer = useRef(0);
  const isCollapsed = state === 'collapsed' && !isMobile;

  useEffect(() => {
    if (!isCollapsed) setOpen(false);
  }, [isCollapsed]);

  if (!isCollapsed) return null;
  const open = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const close = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), PEEK_CLOSE_DELAY);
  };

  return (
    <>
      <div aria-hidden onPointerEnter={open} onPointerLeave={close} className="fixed inset-y-0 left-0 z-40 w-2" />
      <div
        onPointerEnter={open}
        onPointerLeave={close}
        inert={!isOpen || undefined}
        className={cn(
          'fixed inset-y-2 left-2 z-40 w-(--sidebar-width) overflow-hidden rounded-xl bg-sidebar shadow-float transition-[translate,opacity] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity',
          isOpen ? 'translate-x-0 opacity-100 duration-[240ms]' : 'pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0 duration-200',
        )}
      >
        <AppSidebar onSearch={onSearch} collapsible="none" />
      </div>
    </>
  );
}

function SpaceHeader() {
  const space = useSpace();
  const { isMobile } = useSidebar();
  return (
    <SidebarHeader className="h-11 flex-row items-center gap-1.5 py-0 pr-2 pl-2">
      {!isMobile && <SidebarTrigger className="text-muted-foreground" />}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex min-w-0 items-center gap-2 px-1">
            <SpaceIcon space={space} className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate type-meta font-medium">{space.name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {space.profile} profile · Claude {space.accounts.claude} · Codex {space.accounts.codex} · GitHub {space.accounts.github}
        </TooltipContent>
      </Tooltip>
    </SidebarHeader>
  );
}

function SpacePanel({ pos, index, isCurrent, children }: { pos: MotionValue<number>; index: number; isCurrent: boolean; children: ReactNode }) {
  const x = useTransform(pos, (p) => `${(index - p) * 100}%`);
  return (
    <motion.div style={{ x }} inert={!isCurrent || undefined} className={cn(!isCurrent && 'absolute inset-x-0 top-0')}>
      {children}
    </motion.div>
  );
}

function SpaceNav({ spaceId, onSearch }: { spaceId: string; onSearch: () => void }) {
  const { dispatch } = useHarness();
  const view = useView(spaceId);
  const threads = useSpaceThreads(spaceId);
  const queue = useSpaceQueue(spaceId);
  const { setOpenMobile } = useSidebar();
  const go = (v: View) => {
    dispatch({ type: 'go', view: v });
    setOpenMobile(false);
  };

  const pinned = threads.filter((t) => t.orbitSlot !== undefined && t.status !== 'settled');
  const active = threads.filter((t) => t.orbitSlot === undefined && t.status !== 'settled');
  const settled = threads.filter((t) => t.status === 'settled');
  const isActive = (t: Thread) => view.kind === 'thread' && view.id === t.id;
  const row = (t: Thread) => <ThreadItem thread={t} isActive={isActive(t)} onSelect={() => go({ kind: 'thread', id: t.id })} />;

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem
              icon={<Search />}
              label="Search"
              onClick={onSearch}
              trailing={
                <KbdGroup className="hidden md:inline-flex">
                  <Kbd>Cmd</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              }
            />
            <NavItem icon={<Edit />} label="New thread" isActive={view.kind === 'new'} onClick={() => go({ kind: 'new' })} trailing={<Kbd className="hidden md:inline-flex">N</Kbd>} />
            <NavItem icon={<Inbox />} label="Queue" isActive={view.kind === 'queue'} onClick={() => go({ kind: 'queue' })} badge={queue.length > 0 ? queue.length : undefined} />
            <NavItem icon={<Route />} label="Board" isActive={view.kind === 'board'} onClick={() => go({ kind: 'board' })} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <ThreadList pinned={pinned} active={active} row={row} />

      {settled.length > 0 && (
        <Collapsible className="group/settled">
          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="hover:text-sidebar-foreground">
                Settled
                <span className="ml-1 tabular">{settled.length}</span>
                <ChevronRight className="ml-auto size-3 transition-transform duration-150 group-data-[state=open]/settled:rotate-90" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {settled.map((t) => (
                    <SidebarMenuItem key={t.id}>{row(t)}</SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      )}
    </>
  );
}

const PINNED = 'label-pinned';
const UNPINNED = 'label-threads';

/** Pinned and active threads as one draggable list split by the Threads label: dropping a thread above it pins the thread. Alt+Up/Down moves the focused row. */
function ThreadList({ pinned, active, row }: { pinned: Thread[]; active: Thread[]; row: (t: Thread) => ReactNode }) {
  const { dispatch } = useHarness();
  const { isMobile } = useSidebar();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  if (pinned.length + active.length === 0) return null;

  const byId = new Map([...pinned, ...active].map((t) => [t.id, t]));
  const order = [PINNED, ...pinned.map((t) => t.id), UNPINNED, ...active.map((t) => t.id)];
  const reorder = (next: string[]) => {
    if (next[0] !== PINNED) return;
    const split = next.indexOf(UNPINNED);
    dispatch({ type: 'reorder', pinned: next.slice(1, split), unpinned: next.slice(split + 1) });
  };
  const move = (id: string, step: 1 | -1) => {
    const from = order.indexOf(id);
    const to = from + step;
    if (to < 1 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    reorder(next);
  };

  return (
    <SidebarGroup>
      <SidebarMenu asChild>
        <Reorder.Group axis="y" values={order} onReorder={reorder} className="select-none">
          {order.map((id) => {
            if (id === PINNED) return <ListLabel key={id} value={id} className={cn(pinned.length === 0 && !draggingId && 'hidden')}>Pinned</ListLabel>;
            if (id === UNPINNED) return <ListLabel key={id} value={id} className="mt-3">Threads</ListLabel>;
            return (
              <SidebarMenuItem key={id} asChild>
                <Reorder.Item
                  value={id}
                  dragListener={!isMobile}
                  onDragStart={() => setDraggingId(id)}
                  onDragEnd={() => setDraggingId(null)}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    move(id, e.key === 'ArrowUp' ? -1 : 1);
                  }}
                  className={cn('rounded-md', draggingId === id && 'z-10 bg-sidebar shadow-float')}
                >
                  {row(byId.get(id)!)}
                </Reorder.Item>
              </SidebarMenuItem>
            );
          })}
        </Reorder.Group>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function ListLabel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <SidebarMenuItem asChild>
      <Reorder.Item value={value} dragListener={false} className={className}>
        <SidebarGroupLabel>{children}</SidebarGroupLabel>
      </Reorder.Item>
    </SidebarMenuItem>
  );
}

function NavItem({ icon, label, isActive, onClick, trailing, badge }: { icon: ReactNode; label: string; isActive?: boolean; onClick: () => void; trailing?: ReactNode; badge?: number }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onClick}>
        {icon}
        <span>{label}</span>
        {!!trailing && <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover/menu-item:opacity-100">{trailing}</span>}
      </SidebarMenuButton>
      {badge !== undefined && <SidebarMenuBadge className="tabular">{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function ThreadItem({ thread, isActive, onSelect }: { thread: Thread; isActive: boolean; onSelect: () => void }) {
  const row = useThreadRow(thread);
  const { isSettled, toggle: settle } = useSettle(thread);
  const pr = thread.prs[thread.prs.length - 1];
  return (
    <>
      <SidebarMenuButton isActive={isActive} onClick={onSelect} tooltip={thread.title} className="h-auto flex-col items-stretch gap-1 py-2 group-has-data-[sidebar=menu-action]/menu-item:pr-2">
        <span className="flex min-w-0 items-center gap-1.5 type-caption text-subtle-foreground">
          {thread.repo ? (
            <>
              <ProjectAvatar name={thread.repo.project} />
              <span className="shrink-0">{thread.repo.project}</span>
              <span className="min-w-0 truncate font-mono">{thread.repo.branch}</span>
            </>
          ) : (
            <>
              <ChatRound className="size-4 shrink-0" />
              <span className="shrink-0">No project</span>
            </>
          )}
          <span className="ml-auto shrink-0 tabular transition-opacity group-hover/menu-item:opacity-0">{row.ago}</span>
        </span>
        <span className={cn('min-w-0 truncate', isActive && 'text-foreground')}>{thread.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 type-caption text-subtle-foreground">
          <ProgressRing pct={row.pct} slot={thread.line} size={12} />
          <span className="shrink-0 tabular">{Math.round(row.pct * 100)}%</span>
          <span className="min-w-0 flex-1 truncate">{row.detail}</span>
          {!!pr && <PrBadge pr={pr} />}
          {row.needsYou && <span aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" />}
        </span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover onClick={settle} aria-label={isSettled ? `Reactivate ${thread.title}` : `Settle ${thread.title}`} className="top-1.5! aspect-auto h-5 w-auto gap-1 bg-sidebar-accent px-1.5 type-caption [&>svg]:size-3.5">
        {isSettled ? <Undo /> : <Archive />}
        {isSettled ? 'Reactivate' : 'Settle'}
      </SidebarMenuAction>
    </>
  );
}

function ProjectAvatar({ name }: { name: string }) {
  return <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[0.625rem] font-semibold text-foreground uppercase">{name[0]}</span>;
}

const PR_TONE = { open: 'text-success', merged: 'text-subtle-foreground', draft: 'text-subtle-foreground' } satisfies Record<PullRequest['state'], string>;

function PrBadge({ pr }: { pr: PullRequest }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-0.5 tabular', PR_TONE[pr.state])} title={`${pr.title} (${pr.state})`}>
      <BranchUp className="size-3" />
      {pr.number}
    </span>
  );
}

/** What a thread row says under its title: the step in flight, or what it is waiting for. */
function useThreadRow(thread: Thread) {
  const { state } = useHarness();
  const { pct } = progressAt(thread, state.now, true);
  const lastAt = thread.activity[thread.activity.length - 1]?.at ?? thread.startedAt;
  const minutes = Math.max(0, state.now - lastAt);
  const detail = threadDetail(thread, state.queue.find((q) => q.threadId === thread.id)?.title);
  return { pct, detail, ago: minutes < 1 ? 'now' : duration(minutes), needsYou: thread.status === 'needs-you' };
}

function threadDetail(thread: Thread, question?: string) {
  if (thread.status === 'needs-you') return question ?? 'Waiting on you';
  if (thread.status === 'settled') return 'Settled';
  const pr = thread.prs[thread.prs.length - 1];
  if (thread.status === 'review') return pr ? `#${pr.number} ready for review` : 'Ready for review';
  const step = thread.steps.find((s) => s.status === 'running') ?? thread.steps.find((s) => s.status === 'ready');
  return step?.title ?? 'Idle';
}

function SpaceFooter() {
  const { state, dispatch } = useHarness();
  return (
    <SidebarFooter className="flex-row items-center gap-1 px-2 py-2">
      <div role="radiogroup" aria-label="Space" className="flex items-center gap-0.5">
        {SPACES.map((s, i) => {
          const isCurrent = s.id === state.spaceId;
          return (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isCurrent}
                  aria-label={`${s.name} space`}
                  onClick={() => dispatch({ type: 'space', id: s.id })}
                  className={cn('flex size-7 cursor-default items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent/60 hover:text-foreground', isCurrent && 'bg-sidebar-accent text-foreground')}
                >
                  <SpaceIcon space={s} className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {s.name} <Kbd className="ml-1">Ctrl {i + 1}</Kbd>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <span className="flex-1" />
      <ThemeButton />
      <DemoMenu paused={state.paused} />
    </SidebarFooter>
  );
}

function DemoMenu({ paused }: { paused: boolean }) {
  const { dispatch } = useHarness();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Prototype controls" className="text-muted-foreground">
          <More />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Prototype</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => dispatch({ type: 'pause' })}>
            {paused ? <Play /> : <Pause />}
            {paused ? 'Resume simulation' : 'Pause simulation'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatch({ type: 'trigger-overlap' })}>
            <Flash />
            Trigger an overlap
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatch({ type: 'reset' })}>
            <Refresh />
            Reset demo
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal text-subtle-foreground">Hold Option, or long-press, for Orbit</DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeButton() {
  const { theme = 'system', setTheme } = useTheme();
  const next = { system: 'light', light: 'dark', dark: 'system' }[theme] ?? 'system';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => setTheme(next)} aria-label={`Theme: ${theme}. Switch to ${next}`} title={`Theme: ${theme}`} className="text-muted-foreground">
      <Icon />
    </Button>
  );
}

const COMMIT_FRACTION = 0.3;
const FLICK_PROJECTION = 10;
const EDGE_RESISTANCE = 4;
// The web gets no finger-lift signal for trackpad scrolls. Lift with velocity shows up as macOS momentum (deltas decaying every frame) → settle right away.
// Lift at rest is indistinguishable from resting fingers → settle after HOLD_MS of silence, so a pause shorter than that holds the swipe mid-change.
const MOMENTUM_EVENTS = 6;
const HOLD_MS = 500;
const SETTLE = { type: 'spring', bounce: 0, duration: 0.35 } as const;

type Step = 1 | -1;

/** Arc-style: `pos` (fractional space index) tracks the horizontal scroll 1:1 and settles once the gesture ends — at most one space per gesture. */
function useSpaceSwipe(index: number, onStep: (step: Step) => void) {
  const pos = useMotionValue(index);
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef({ axis: null as 'x' | 'y' | null, offset: 0, lastDelta: 0, decaying: 0, isReleased: false });
  const endTimer = useRef(0);
  const canStep = (step: Step) => !!SPACES[index + step];

  useEffect(() => {
    const controls = animate(pos, index, SETTLE);
    return () => controls.stop();
  }, [index, pos]);

  const release = () => {
    const g = gesture.current;
    g.isReleased = true;
    const width = ref.current?.clientWidth ?? 1;
    const projected = g.offset + g.lastDelta * FLICK_PROJECTION;
    const step: Step = projected > 0 ? 1 : -1;
    if (Math.abs(projected) >= width * COMMIT_FRACTION && canStep(step)) onStep(step);
    else animate(pos, index, SETTLE);
  };

  const end = () => {
    if (!gesture.current.isReleased && gesture.current.axis === 'x') release();
    gesture.current = { axis: null, offset: 0, lastDelta: 0, decaying: 0, isReleased: false };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.deltaX && !e.deltaY) return;
    const g = gesture.current;
    g.axis ??= Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'x' : 'y';
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(end, g.isReleased ? 140 : HOLD_MS);
    if (g.axis === 'y' || g.isReleased) return;

    const isDecaying = Math.sign(e.deltaX) === Math.sign(g.lastDelta) && Math.abs(e.deltaX) < Math.abs(g.lastDelta);
    g.decaying = isDecaying ? g.decaying + 1 : 0;
    g.lastDelta = e.deltaX;
    if (g.decaying >= MOMENTUM_EVENTS) return release();

    const width = ref.current?.clientWidth ?? 1;
    g.offset = Math.max(-width, Math.min(width, g.offset + e.deltaX));
    const isPastEdge = !canStep(g.offset > 0 ? 1 : -1);
    pos.set(index + g.offset / width / (isPastEdge ? EDGE_RESISTANCE : 1));
  };

  return { pos, ref, onWheel };
}
