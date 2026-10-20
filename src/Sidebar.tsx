import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { limitStatus } from './chat/LimitCard';
import { createPortal } from 'react-dom';
import { motion, type MotionProps } from 'motion/react';
import { Archive, Chart, Chat, Edit, Folder, Eye, Hierarchy, Inbox, Menu, Route, Search, TaskSquare, Undo } from '@/icons';
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
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { PrStack } from './git/PrStack';
import { useIdleVerdict, VerdictChip } from './goals/VerdictChip';
import { PIN_SLOTS, type Thread } from './model';
import { useProfiles } from './profiles';
import { endDrag, moveDrag, startDrag } from './layout/drag';
import { ThreadPeek } from './layout/ThreadPeek';
import { ThreadRowMenu } from './menus/ThreadRowMenu';
import { useIsMultiSplit } from './SidebarToggle';
import { extendSelection, selectRange, toggleSelected, type Selection } from './selection';
import { isMod } from './keys';
import { NotificationBell } from './notify/NotificationBell';
import { activeThreads, dropPin, lastActivityAt, orderBetween, pinnedThreads, pinOrderOf, stepPin } from './reorder';
import { SidebarResizer } from './SidebarResizer';
import { useSettle } from './useSettle';
import { NextRunBadge } from './schedule/NextRunBadge';
import { useReviewEntry } from './review/useReviewMode';
import { useSnapPager } from './useSnapPager';
import { haptic } from './haptic';
import { useHarness, useSpace, useSpaceQueue, useSpaceThreads, useView, type State, type View } from './store';
import type { FollowedMachine } from './host/types/remote';
import { duration, goalProgress } from './progress';
import { NEXT_STEP_TITLES, reportHeadline } from './goals/report';
import { ProgressRing, SpaceIcon, TooltipIconButton, UnreadDot } from './ui';
import { isUnread } from './store/seen';
import { agentPhase, isWorking, PHASE_LABELS, workingLabel } from './agentPhase';
import { AgentLoader } from './AgentLoader';
import { runningBackground } from './runtime/subagents';
import { BoundShortcut } from './Shortcut';
import { spaceCommand } from './keymap';
import { BranchIcon, BranchName } from './git/BranchLabel';
import { remoteDecisions, remoteThreads } from './remote/mirror';
import { openRemoteThread, useRemoteThreadRoute } from './remote/open';
import { DeviceIcon } from './remote/DeviceIcon';
import { MachinePresence } from './remote/MachinePresence';
import { RemoteScope, useMachines } from './remote/useMachines';
import { UserMenu } from './UserMenu';
import { FoldGroup } from './SidebarFold';
import { ProjectIcon } from './ProjectIcon';
import { useProjectAt } from './projects';
import { HAS_CAPTIONS } from './windowCaptions';
import { host } from './host';

export function AppSidebar({ onSearch, collapsible, width, onResize }: { onSearch: () => void; collapsible?: 'offcanvas' | 'icon' | 'none'; width?: number; onResize?: (px: number) => void }) {
  const { state, dispatch } = useHarness();
  const profiles = useProfiles();
  const index = profiles.findIndex((s) => s.id === state.spaceId);
  const pager = useRef<HTMLDivElement>(null);
  useSnapPager(pager, { axis: 'x', index, onSettle: (page) => dispatch({ type: 'space', id: profiles[page].id }), onCross: haptic });

  return (
    <Sidebar collapsible={collapsible}>
      <SpaceHeader />
      {/* Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility. */}
      <SidebarContent ref={pager} style={{ scrollbarWidth: 'none' }} className="snap-x snap-mandatory flex-row gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain">
        {/* Every space stays mounted so neighbours show mid-swipe; window to index ± 1 if the space count grows. */}
        {profiles.map((s, i) => (
          <SpacePanel key={s.id} isCurrent={i === index}>
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
// Outlasts the 160ms morph and the chat's 260ms slide; the docked sidebar underneath is identical, so lingering costs nothing.
const DOCK_MS = 300;

/** Arc-style: with the sidebar collapsed, resting on the left edge slides it back in as a floating panel. Its own toggle docks it in place: the panel grows to the window edge and loses its corners while the chat makes room behind it, then the docked sidebar takes over underneath. */
export function SidebarPeek({ onSearch }: { onSearch: () => void }) {
  const { state, isMobile, setOpen: setSidebarOpen } = useSidebar();
  const [isOpen, setOpen] = useState(false);
  const [isDocking, setDocking] = useState(false);
  const closeTimer = useRef(0);
  const isCollapsed = state === 'collapsed' && !isMobile;

  useEffect(() => {
    if (!isCollapsed) setOpen(false);
  }, [isCollapsed]);

  if (!isCollapsed && !isDocking) return null;
  const open = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const close = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), PEEK_CLOSE_DELAY);
  };
  const dock = (e: ReactMouseEvent) => {
    if (!(e.target as Element).closest('[data-sidebar="trigger"]')) return;
    e.stopPropagation();
    window.clearTimeout(closeTimer.current);
    setDocking(true);
    setSidebarOpen(true);
    window.setTimeout(() => setDocking(false), DOCK_MS);
  };

  return (
    <>
      {!isDocking && <div aria-hidden onPointerEnter={open} onPointerLeave={close} className="fixed inset-y-0 left-0 z-40 w-2" />}
      <div
        onPointerEnter={open}
        onPointerLeave={close}
        onClickCapture={dock}
        inert={(!isOpen && !isDocking) || undefined}
        className={cn(
          'fixed z-40 w-(--sidebar-width) overflow-hidden border-r bg-sidebar ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity',
          isDocking
            ? 'inset-y-0 left-0 rounded-none border-sidebar-border shadow-none transition-[top,bottom,left,border-radius,border-color,box-shadow] duration-[160ms]'
            : 'inset-y-2 left-2 rounded-xl border-transparent shadow-float transition-[translate,opacity]',
          !isDocking && (isOpen ? 'translate-x-0 opacity-100 duration-[240ms]' : 'pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0 duration-200'),
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
  const isMulti = useIsMultiSplit();
  return (
    <SidebarHeader className="app-drag h-11 flex-row items-center gap-1.5 py-0 pr-2 pl-2 md:in-data-traffic-lights:pl-[calc(var(--lights-end)+5px)]">
      {HAS_CAPTIONS && <AppMenuButton />}
      {!isMobile && !isMulti && <SidebarTrigger className="ml-1 text-muted-foreground" />}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex min-w-0 items-center gap-2 px-1">
            <SpaceIcon space={space} className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate type-meta font-medium">{space.name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {[space.plans.claude && `Claude ${space.plans.claude}`, space.plans.codex && `Codex ${space.plans.codex}`, space.github && `GitHub ${space.github}`].filter(Boolean).join(' · ') || `${space.name} profile`}
        </TooltipContent>
      </Tooltip>
    </SidebarHeader>
  );
}

/** Windows has no menu bar: File, Edit, View and Window open from here, under the button. */
function AppMenuButton() {
  const open = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const { left, bottom } = e.currentTarget.getBoundingClientRect();
    void host.windows.showAppMenu(Math.round(left), Math.round(bottom + 4));
  };
  return (
    <TooltipIconButton label="Menu" hint="File, Edit, View, Window" onClick={open} className="text-muted-foreground">
      <Menu />
    </TooltipIconButton>
  );
}

function SpacePanel({ isCurrent, children }: { isCurrent: boolean; children: ReactNode }) {
  return (
    <div inert={!isCurrent || undefined} className="flex w-full shrink-0 snap-start snap-always flex-col gap-2 overflow-y-auto overscroll-y-contain">
      {children}
    </div>
  );
}

function SpaceNav({ spaceId, onSearch }: { spaceId: string; onSearch: () => void }) {
  const { dispatch } = useHarness();
  const view = useView(spaceId);
  const threads = useSpaceThreads(spaceId);
  const queue = useSpaceQueue(spaceId);
  const remoteQueueCount = useMachines().machines.reduce((n, m) => n + (m.state ? remoteDecisions(m.state).length : 0), 0);
  const review = useReviewEntry(spaceId);
  const { setOpenMobile } = useSidebar();
  const go = (v: View) => {
    dispatch({ type: 'go', view: v });
    setOpenMobile(false);
  };

  const pinned = pinnedThreads(threads, spaceId);
  const active = activeThreads(threads, spaceId);
  const settled = threads.filter((t) => t.status === 'settled');
  const isActive = (t: Thread) => view.kind === 'thread' && view.id === t.id;
  const order = [...pinned, ...active, ...settled].map((t) => t.id);
  const selection = useThreadSelection(order, view.kind === 'thread' ? view.id : undefined);
  const row = (t: Thread) => (
    <ThreadItem
      thread={t}
      isActive={isActive(t)}
      isSelected={selection.ids.includes(t.id)}
      onSelect={(e) => selection.onClick(e, t.id) && go({ kind: 'thread', id: t.id })}
    />
  );

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
                <BoundShortcut command="palette" className="hidden md:inline-flex" />
              }
            />
            <NavItem icon={<Edit />} label="New thread" isActive={view.kind === 'new'} onClick={() => go({ kind: 'new' })} trailing={<BoundShortcut command="go-new" className="hidden md:inline-flex" />} />
            <NavItem icon={<Inbox />} label="Queue" isActive={view.kind === 'queue'} onClick={() => go({ kind: 'queue' })} badge={queue.length + remoteQueueCount > 0 ? queue.length + remoteQueueCount : undefined} />
            {review.count > 0 && <NavItem icon={<TaskSquare />} label="Review" isActive={review.isOpen} onClick={review.open} badge={review.count} />}
            <NotificationBell spaceId={spaceId} />
            <NavItem icon={<Route />} label="Board" isActive={view.kind === 'board'} onClick={() => go({ kind: 'board' })} />
            <NavItem icon={<Folder />} label="Projects" isActive={view.kind === 'projects'} onClick={() => go({ kind: 'projects' })} />
            <NavItem icon={<Chart />} label="Usage" isActive={view.kind === 'usage'} onClick={() => go({ kind: 'usage' })} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* `contents` keeps the groups' own layout; it only collects Esc and Shift ↑/↓ from every thread row. */}
      <div className="contents" onKeyDown={selection.onKeyDown}>
        <ThreadList pinned={pinned} remotePins={useRemotePins()} active={active} row={row} selectedIds={selection.ids} />

        {settled.length > 0 && (
          <FoldGroup label="Settled" count={settled.length}>
            {settled.map((t) => (
              <ThreadRowMenu key={t.id} threadId={t.id} selectedIds={selection.ids}>
                <SidebarMenuItem data-thread-row={t.id}>{row(t)}</SidebarMenuItem>
              </ThreadRowMenu>
            ))}
          </FoldGroup>
        )}
      </div>
      <MachineThreads />
    </>
  );
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ROW_LAYOUT = { duration: 0.2, ease: EASE_OUT };

/** Your other computers' threads, each under its computer's name: they run there, and open here to follow and steer. */
function MachineThreads() {
  const { machines } = useMachines();
  const route = useRemoteThreadRoute();
  return machines.map(({ machine, state }) => {
    const { active, settled } = state ? remoteThreads(state) : { active: [], settled: [] };
    const row = (t: Thread) => (
      <SidebarMenuItem key={t.id} data-remote-thread-row={t.id}>
        <ThreadItem thread={t} isActive={route?.machineId === machine.id && route.threadId === t.id} onSelect={() => openRemoteThread({ machineId: machine.id, threadId: t.id })} />
      </SidebarMenuItem>
    );
    const label = (
      <SidebarGroupLabel className="gap-1.5">
        <DeviceIcon kind={machine.kind} className="size-3.5! shrink-0" />
        <span className="min-w-0 truncate">{machine.name}</span>
        <MachinePresence machine={machine} />
      </SidebarGroupLabel>
    );
    if (!state)
      return (
        <SidebarGroup key={machine.id}>
          {label}
        </SidebarGroup>
      );
    // Settled folds below as its own group, level with the machine's, as this computer's own does.
    return (
      <RemoteScope key={machine.id} machine={machine} state={state}>
        <SidebarGroup>
          {label}
          <SidebarMenu>
            {active.map(row)}
            {active.length === 0 && <li className="px-2 type-caption text-subtle-foreground">No active threads</li>}
          </SidebarMenu>
        </SidebarGroup>
        {settled.length > 0 && <FoldGroup label="Settled" count={settled.length}>{settled.map(row)}</FoldGroup>}
      </RemoteScope>
    );
  });
}

/**
 * Finder-style selection over the space's thread rows: a plain click opens the thread and clears it, Shift-click selects a range
 * from the anchor, mod-click adds or removes one, Shift ↑/↓ extends from the focused row, Esc clears.
 */
function useThreadSelection(order: string[], openId: string | undefined) {
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: undefined });
  const current = { ids: selection.ids.filter((id) => order.includes(id)), anchor: selection.anchor ?? openId };

  /** True when the click should open the thread. */
  const onClick = (e: ReactMouseEvent, id: string) => {
    if (e.shiftKey) return void setSelection({ ids: selectRange(order, current.anchor, id), anchor: current.anchor });
    if (isMod(e)) return void setSelection(toggleSelected(order, current, id));
    setSelection({ ids: [], anchor: id });
    return true;
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && current.ids.length > 0) {
      e.stopPropagation();
      return setSelection({ ids: [], anchor: undefined });
    }
    const id = (e.target as HTMLElement).closest('[data-thread-row]')?.getAttribute('data-thread-row');
    if (!id || !e.shiftKey || e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const next = extendSelection(order, { ids: current.ids, anchor: current.ids.length > 0 ? current.anchor : id }, id, e.key === 'ArrowUp' ? -1 : 1);
    if (!next) return;
    setSelection(next.selection);
    e.currentTarget.querySelector<HTMLElement>(`[data-thread-row="${next.focusId}"] [data-sidebar=menu-button]`)?.focus();
  };
  return { ids: current.ids, onClick, onKeyDown };
}

/** Pinned threads in your order, then the rest by recent activity, split by the Threads label. Drag a row across the label to pin or unpin, within Pinned to reorder, or out onto a split to open it there. Alt ↑/↓ does the same from the keyboard. */
function ThreadList({ pinned, remotePins, active, row, selectedIds }: { pinned: Thread[]; remotePins: RemotePin[]; active: Thread[]; row: (t: Thread) => ReactNode; selectedIds: string[] }) {
  const { dispatch } = useHarness();
  const { run } = useMachines();
  const route = useRemoteThreadRoute();
  const listRef = useRef<HTMLUListElement>(null);
  const pins = mergePins(pinned, remotePins);
  const pinnedIds = pinned.map((t) => t.id);
  const activeIds = active.map((t) => t.id);
  const reorder = (lists: { pinned: string[]; unpinned: string[] } | null) => lists && dispatch({ type: 'reorder', ...lists, at: Date.now() });
  const drop = (dragged: ListRow, slot: NonNullable<RowDragState['slot']>) => {
    if (!dragged.remote && !slot.toPinned) return reorder(dropPin(pinnedIds, activeIds, dragged.thread.id, false, slot.index));
    const others = pins.filter((p) => p.rowId !== dragged.rowId);
    const order = orderBetween(others[slot.index - 1] && pinOrderOf(others[slot.index - 1].thread), others[slot.index] && pinOrderOf(others[slot.index].thread), Date.now());
    if (!dragged.remote) return dispatch({ type: 'pin-at', threadId: dragged.thread.id, order });
    void run(dragged.remote.machine.id, slot.toPinned ? { type: 'pin', threadId: dragged.thread.id, isPinned: true, order } : { type: 'pin', threadId: dragged.thread.id, isPinned: false });
  };
  const drag = useRowDrag(listRef, pinnedIds, drop);
  if (pins.length + active.length === 0) return null;

  const dragged = drag.state && [...pins, ...active.map(localRow)].find((r) => r.rowId === drag.state!.id);
  const step = (id: string, by: 1 | -1) => {
    reorder(stepPin(pinnedIds, activeIds, id, by));
    // Moving a focused node in the DOM can drop its focus; put it back on the row.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-sidebar=menu-button]`)?.focus());
  };
  const section = (rows: ListRow[], isPinned: boolean) => {
    const items = rows.filter((r) => r.rowId !== drag.state?.id).map((r) => {
      const t = r.thread;
      const rowProps = { 'data-row-id': r.rowId, 'data-pinned': isPinned || undefined, onPointerDown: (e: React.PointerEvent<HTMLLIElement>) => drag.onPointerDown(e, r) } as const;
      if (r.remote)
        return (
          <SidebarMenuItem key={r.rowId} asChild {...rowProps} data-remote-thread-row={t.id}>
            <motion.li {...glide}>
              <RemoteScope machine={r.remote.machine} state={r.remote.state}>
                <ThreadItem thread={t} machine={r.remote.machine} isActive={route?.machineId === r.remote.machine.id && route.threadId === t.id} onSelect={() => openRemoteThread({ machineId: r.remote!.machine.id, threadId: t.id })} />
              </RemoteScope>
            </motion.li>
          </SidebarMenuItem>
        );
      const item = (
        <ThreadRowMenu key={t.id} threadId={t.id} selectedIds={selectedIds}>
          <SidebarMenuItem
            asChild
            {...rowProps}
            data-thread-row={t.id}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              step(t.id, e.key === 'ArrowUp' ? -1 : 1);
            }}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          >
            <motion.li {...glide}>{row(t)}</motion.li>
          </SidebarMenuItem>
        </ThreadRowMenu>
      );
      // The number is this computer's Orbit slot: another computer's pins have their own there.
      const pinNumber = isPinned ? pinnedIds.indexOf(t.id) + 1 : undefined;
      return (
        <ThreadPeek key={t.id} thread={t} pinNumber={pinNumber} isDisabled={!!drag.state}>
          {item}
        </ThreadPeek>
      );
    });
    const slot = drag.state?.slot;
    // Threads sort by recency, so a row dropped there lands where its last activity puts it, not where the pointer is.
    const at = slot && !isPinned && dragged ? rows.filter((r) => r.rowId !== dragged.rowId && lastActivityAt(r.thread) > lastActivityAt(dragged.thread)).length : slot?.index;
    if (slot && slot.toPinned === isPinned) items.splice(at!, 0, <DropPlaceholder key="placeholder" height={drag.state!.height} glide={glide} />);
    return items;
  };
  const showPinned = pins.length > 0 || !!drag.state;
  // Rows only re-measure when the order or the drop slot changes, so ticks, scrolling and space swipes never animate them.
  const glide = { layout: 'position', layoutDependency: rowOrderKey(pins.map((p) => p.rowId), activeIds, drag.state), transition: ROW_LAYOUT } as const;
  const isPinnedEmpty = pins.filter((p) => p.rowId !== drag.state?.id).length === 0 && drag.state?.slot?.toPinned !== true;

  return (
    <SidebarGroup>
      <SidebarMenu ref={listRef} className="relative select-none">
        {showPinned && (
          <motion.li {...glide}>
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
          </motion.li>
        )}
        {section(pins, true)}
        {!!drag.state && isPinnedEmpty && (
          <motion.li {...glide} aria-hidden className="mx-2 flex h-9 items-center justify-center rounded-md border border-dashed type-caption text-subtle-foreground">
            Drop here to pin
          </motion.li>
        )}
        <motion.li {...glide} data-threads-label className="mt-3">
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
        </motion.li>
        {section(active.map(localRow), false)}
      </SidebarMenu>
      {!!drag.state && !!dragged && <RowGhost thread={dragged.thread} drag={drag.state} />}
    </SidebarGroup>
  );
}

/** Another computer's pinned thread, shown in this computer's Pinned list. */
interface RemotePin {
  machine: FollowedMachine;
  state: State;
  thread: Thread;
}

/** A row of the thread list; another computer's carries where it runs, and a row id that can't clash with a thread here. */
interface ListRow {
  rowId: string;
  thread: Thread;
  remote?: RemotePin;
}

const localRow = (thread: Thread): ListRow => ({ rowId: thread.id, thread });

/** Every computer's pins as one list, by pin order (`pinOrderOf`); this computer's first among equal keys. */
function mergePins(pinned: Thread[], remotePins: RemotePin[]): ListRow[] {
  const rows = [...pinned.map(localRow), ...remotePins.map((remote) => ({ rowId: `${remote.machine.id}:${remote.thread.id}`, thread: remote.thread, remote }))];
  return rows.map((row, i) => ({ row, i })).sort((a, b) => pinOrderOf(a.row.thread) - pinOrderOf(b.row.thread) || a.i - b.i).map(({ row }) => row);
}

/** Your other computers' pinned threads, from what each last streamed. */
function useRemotePins(): RemotePin[] {
  return useMachines().machines.flatMap(({ machine, state }) => (state ? pinnedThreads(state.threads, state.spaceId).map((thread) => ({ machine, state, thread })) : []));
}

function rowOrderKey(pinnedIds: string[], activeIds: string[], drag: RowDragState | null) {
  const slot = drag?.slot ? `${drag.slot.toPinned ? 'p' : 'u'}${drag.slot.index}` : '';
  return `${pinnedIds.join(',')}|${activeIds.join(',')}|${drag?.id ?? ''}|${slot}`;
}

function DropPlaceholder({ height, glide }: { height: number; glide: MotionProps }) {
  return (
    <motion.li {...glide} aria-hidden className="relative" style={{ height }}>
      <span className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-foreground/40" />
    </motion.li>
  );
}

function RowGhost({ thread, drag }: { thread: Thread; drag: RowDragState }) {
  return createPortal(
    <ul aria-hidden data-sidebar="menu" className="pointer-events-none fixed z-[600] list-none rounded-md bg-sidebar text-sidebar-foreground shadow-float" style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, width: drag.width }}>
      <SidebarMenuItem>
        <ThreadItem thread={thread} isActive={false} onSelect={() => undefined} />
      </SidebarMenuItem>
    </ul>,
    document.body,
  );
}

interface RowDragState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  grabX: number;
  grabY: number;
  slot: { toPinned: boolean; index: number } | null;
}

const DRAG_THRESHOLD = 5;
const EDGE_SCROLL_PX = 40;
const EDGE_SCROLL_SPEED = 12;
const LIST_SLACK_PX = 24;

/** Pointer drag for sidebar rows: placeholder slot from live row midpoints, edge auto-scroll, and a hand-off to the split drop zones once the pointer leaves the sidebar. */
function useRowDrag(listRef: React.RefObject<HTMLUListElement | null>, pinnedIds: string[], onDrop: (row: ListRow, slot: NonNullable<RowDragState['slot']>) => void) {
  const { dispatch } = useHarness();
  const { isMobile } = useSidebar();
  const [drag, setDrag] = useState<RowDragState | null>(null);
  const latest = useRef({ pinnedIds, onDrop });
  latest.current = { pinnedIds, onDrop };

  const onPointerDown = (e: React.PointerEvent<HTMLLIElement>, row: ListRow) => {
    const { thread } = row;
    if (e.button !== 0 || isMobile || (e.target as HTMLElement).closest('[data-sidebar=menu-action]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let current: RowDragState | null = null;
    let pointerY = e.clientY;
    let frame = 0;

    const scroller = () => listRef.current?.closest<HTMLElement>('[data-sidebar=content]');
    const autoScroll = () => {
      const el = scroller();
      if (current && el) {
        const r = el.getBoundingClientRect();
        if (pointerY < r.top + EDGE_SCROLL_PX) el.scrollTop -= EDGE_SCROLL_SPEED;
        else if (pointerY > r.bottom - EDGE_SCROLL_PX) el.scrollTop += EDGE_SCROLL_SPEED;
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const update = (next: RowDragState) => {
      current = next;
      setDrag(next);
    };

    const onMove = (ev: PointerEvent) => {
      pointerY = ev.clientY;
      if (!current) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        // Another computer's thread opens over the app, never in one of this computer's splits.
        if (!row.remote) startDrag({ kind: 'thread', id: thread.id }, thread.title, ev.clientX, ev.clientY, { hasOwnGhost: true });
        document.documentElement.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
        frame = requestAnimationFrame(autoScroll);
      }
      if (!row.remote) moveDrag(ev.clientX, ev.clientY);
      update({ id: row.rowId, x: ev.clientX, y: ev.clientY, width: rect.width, height: rect.height, grabX: start.x - rect.left, grabY: start.y - rect.top, slot: slotAt(listRef.current, row.rowId, latest.current.pinnedIds, !!row.remote, ev.clientX, ev.clientY) });
    };
    const finish = (isCancel: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(frame);
      if (!current) return;
      document.documentElement.style.userSelect = '';
      // The pointerup after a drag still fires a click on the row; swallow it so the drop doesn't also navigate.
      const swallow = (c: MouseEvent) => c.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
      const landed = row.remote ? null : endDrag();
      const { slot } = current;
      setDrag(null);
      if (isCancel) return;
      if (landed) return dispatch({ type: 'layout-drop', leafId: landed.leafId, zone: landed.zone, view: landed.view });
      if (slot) latest.current.onDrop(row, slot);
    };
    const onUp = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !current) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  return { state: drag, onPointerDown };
}

/**
 * Where a dragged row would land, read from the rows as rendered (the placeholder included), so moving the placeholder never flips the answer back.
 * Positions come from `offsetTop` within the (relative) list, not `getBoundingClientRect`: rows gliding to their new place carry a transform that would flip the slot mid-animation.
 * Above the Threads label is Pinned; a full Pinned sends the row to the top of Threads.
 */
function slotAt(list: HTMLUListElement | null, draggedId: string, pinnedIds: string[], isRemote: boolean, x: number, y: number): RowDragState['slot'] {
  if (!list) return null;
  const box = list.getBoundingClientRect();
  if (x < box.left - LIST_SLACK_PX || x > box.right + LIST_SLACK_PX) return null;
  const mid = (el: HTMLElement) => box.top + el.offsetTop + el.offsetHeight / 2;
  // Five pins per computer: another computer's row only counts its own, so its machine decides.
  const isFull = !isRemote && pinnedIds.filter((id) => id !== draggedId).length >= PIN_SLOTS.length;
  const toPinned = y < mid(list.querySelector<HTMLElement>('[data-threads-label]')!) && !isFull;
  const rows = [...list.querySelectorAll<HTMLElement>(toPinned ? '[data-row-id][data-pinned]' : '[data-row-id]:not([data-pinned])')];
  const index = rows.filter((r) => mid(r) < y).length;
  return { toPinned, index };
}

function NavItem({ icon, label, isActive, onClick, trailing, badge }: { icon: ReactNode; label: string; isActive?: boolean; onClick: () => void; trailing?: ReactNode; badge?: number }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onClick} className="text-xs [&_svg]:size-3.5">
        {icon}
        <span>{label}</span>
        {!!trailing && <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover/menu-item:opacity-100">{trailing}</span>}
      </SidebarMenuButton>
      {badge !== undefined && <SidebarMenuBadge className="tabular">{badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

/** `machine`: the computer it runs on, for another computer's thread among this one's (Pinned). */
export function ThreadItem({ thread, machine, isActive, isSelected, onSelect }: { thread: Thread; machine?: FollowedMachine; isActive: boolean; isSelected?: boolean; onSelect: (e: ReactMouseEvent) => void }) {
  const row = useThreadRow(thread);
  // Demo threads have no agent; their rows keep reading from goal steps.
  const verdict = useIdleVerdict(thread);
  const shown = thread.live ? verdict : null;
  const hasChip = !!shown && shown.kind !== 'idle' && shown.kind !== 'checking';
  const { isSettled, toggle: settle } = useSettle(thread);
  const project = useProjectAt(thread.spaceId, thread.repo?.path);
  return (
    <>
      <SidebarMenuButton
        isActive={isActive}
        data-selected={isSelected || undefined}
        aria-description={isSelected ? 'Selected' : undefined}
        onClick={onSelect}
        tooltip={thread.title}
        className="h-auto flex-col items-stretch gap-1 py-2 group-has-data-[sidebar=menu-action]/menu-item:pr-2 data-selected:bg-sidebar-accent"
      >
        <span className="flex min-w-0 items-center gap-1.5 type-caption text-subtle-foreground">
          {!!machine && (
            <>
              <DeviceIcon kind={machine.kind} className="size-4 shrink-0" />
              <span className="sr-only">On {machine.name}</span>
            </>
          )}
          {thread.repo ? (
            <>
              <ProjectIcon name={thread.repo.project} icon={project?.icon} />
              <span className="shrink-0">{thread.repo.project}</span>
              {/* A worktree is the default; working in the project's own checkout, or on a detached HEAD, is worth a glance. */}
              {(thread.repo.mode === 'folder' || thread.repo.isDetached) && <BranchIcon repo={thread.repo} />}
              <BranchName repo={thread.repo} />
            </>
          ) : (
            <>
              <Chat className="size-4 shrink-0" />
              <span className="shrink-0">No project</span>
            </>
          )}
          {/* While the Settle / Reactivate chip covers this slot, it widens to the chip's width so the branch truncates before the chip instead of under it. */}
          <span className={cn('ml-auto shrink-0 tabular group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0', isSettled ? 'group-focus-within/menu-item:min-w-20 group-hover/menu-item:min-w-20' : 'group-focus-within/menu-item:min-w-14 group-hover/menu-item:min-w-14')}>{row.ago}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('min-w-0 truncate', (isActive || row.isUnread) && 'text-foreground')}>{thread.title}</span>
          {row.isUnread && !isActive && <UnreadDot className="ml-auto" />}
        </span>
        {/* overflow-visible: the PR discs are 4px taller than the line, and the button truncates its last line. */}
        <span className="flex min-w-0 items-center gap-1.5 overflow-visible! type-caption text-subtle-foreground">
          <ProgressRing met={row.progress.met} total={row.progress.total} slot={thread.line} size={12} isWorking={row.isWorking} />
          {!!row.progress.total && <span className="shrink-0 tabular">{`${row.progress.met}/${row.progress.total}`}</span>}
          {!row.isWorking && hasChip && <VerdictChip verdict={shown} />}
          <span className="flex min-w-0 flex-1 items-center gap-1" title={shown?.reason ?? row.detail}>
            <AgentLoader phase={row.phase} className="size-3.5" />
            {row.isWorking ? <Shimmer as="span" className="min-w-0 truncate">{PHASE_LABELS[row.phase]}</Shimmer> : !hasChip && <span className="min-w-0 truncate">{PHASE_LABELS[row.phase]}</span>}
          </span>
          {row.isWatched && <Eye aria-label="Watched" className="size-3 shrink-0" />}
          <PrStack thread={thread} />
          <AgentsBadge thread={thread} />
          <NextRunBadge threadId={thread.id} />
          {row.needsYou && shown?.kind !== 'needs-you' && <span aria-label="Needs you" className="size-1.5 shrink-0 rounded-full bg-warning" />}
        </span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover onClick={settle} aria-label={isSettled ? `Reactivate ${thread.title}` : `Settle ${thread.title}`} className="top-1.5! aspect-auto h-5 w-auto gap-1 bg-sidebar bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-accent))] px-1.5 type-caption [&>svg]:size-3.5">
        {isSettled ? <Undo /> : <Archive />}
        {isSettled ? 'Reactivate' : 'Settle'}
      </SidebarMenuAction>
    </>
  );
}

/** How many background agents the thread has running; nothing when none do. */
function AgentsBadge({ thread }: { thread: Thread }) {
  const running = runningBackground(thread);
  if (!running) return null;
  const label = AGENTS_LABEL.select(running) === 'one' ? '1 background agent running' : `${running} background agents running`;
  return (
    <span aria-label={label} title={label} className="flex shrink-0 items-center gap-0.5 tabular text-muted-foreground">
      <Hierarchy aria-hidden className="size-3" />
      {running}
    </span>
  );
}

const AGENTS_LABEL = new Intl.PluralRules('en');

/** What a thread row says under its title: the step in flight, or what it is waiting for. */
function useThreadRow(thread: Thread) {
  const { state } = useHarness();
  const progress = goalProgress(thread);
  const lastAt = lastActivityAt(thread);
  const minutes = Math.max(0, state.now - lastAt);
  const detail = threadDetail(thread, state.queue.find((q) => q.threadId === thread.id)?.title);
  return { progress, detail, phase: agentPhase(thread), ago: minutes < 1 ? 'now' : duration(minutes), needsYou: thread.status === 'needs-you', isUnread: isUnread(thread), isWorking: isWorking(thread), isWatched: state.watched.includes(thread.id) };
}

export function threadDetail(thread: Thread, question?: string) {
  const limit = limitStatus(thread);
  if (limit) return limit;
  if (thread.status === 'needs-you') return question ?? 'Waiting on you';
  if (thread.status === 'settled') return 'Settled';
  const pr = thread.prs[thread.prs.length - 1];
  if (thread.status === 'review') return pr ? `#${pr.number} ready for review` : NEXT_STEP_TITLES['open-pr'];
  // A live agent reports what it's doing; idle, its last report says where things stand; demo threads are told by their goal steps.
  if (thread.live) return workingLabel(thread) ?? reportHeadline(thread) ?? 'Idle';
  const step = thread.steps.find((s) => s.status === 'running') ?? thread.steps.find((s) => s.status === 'ready');
  return step?.title ?? 'Idle';
}

function SpaceFooter() {
  const { state, dispatch } = useHarness();
  const profiles = useProfiles();
  return (
    <SidebarFooter className="flex-row items-center gap-1 px-2 py-2">
      <UserMenu />
      <span className="flex-1" />
      <div role="radiogroup" aria-label="Profile" className="flex items-center gap-0.5">
        {profiles.map((s, i) => {
          const isCurrent = s.id === state.spaceId;
          return (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isCurrent}
                  aria-label={`${s.name} profile`}
                  onClick={() => dispatch({ type: 'space', id: s.id })}
                  className={cn('flex size-7 cursor-default items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent/60 hover:text-foreground', isCurrent && 'bg-sidebar-accent text-foreground')}
                >
                  <SpaceIcon space={s} className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {s.name} <BoundShortcut command={spaceCommand(i + 1)} className="ml-1" />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </SidebarFooter>
  );
}
