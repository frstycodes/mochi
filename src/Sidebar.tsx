import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import { Archive, BranchUp, ChatRound, ChevronRight, Edit, Eye, Flash, Inbox, Monitor, Moon, Pause, Play, Refresh, Route, Search, Sun, TaskSquare, Undo } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
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
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PIN_SLOTS, SPACES, type PullRequest, type Thread } from './model';
import { endDrag, moveDrag, startDrag } from './layout/drag';
import { ThreadPeek } from './layout/ThreadPeek';
import { ThreadRowMenu } from './menus/ThreadRowMenu';
import { extendSelection, selectRange, toggleSelected, type Selection } from './selection';
import { isMod } from './keys';
import { NotificationBell } from './notify/NotificationBell';
import { activeThreads, dropPin, pinnedThreads, stepPin } from './reorder';
import { SidebarResizer } from './SidebarResizer';
import { useSettle } from './useSettle';
import { useReviewEntry } from './review/useReviewMode';
import { useSnapPager } from './useSnapPager';
import { useHarness, useSpace, useSpaceQueue, useSpaceThreads, useView, type View } from './store';
import { duration, progressAt } from './progress';
import { OverflowIcon, ProgressRing, SpaceIcon } from './ui';
import { Shortcut } from './Shortcut';

export function AppSidebar({ onSearch, collapsible, width, onResize }: { onSearch: () => void; collapsible?: 'offcanvas' | 'icon' | 'none'; width?: number; onResize?: (px: number) => void }) {
  const { state, dispatch } = useHarness();
  const index = SPACES.findIndex((s) => s.id === state.spaceId);
  const pager = useRef<HTMLDivElement>(null);
  useSnapPager(pager, { axis: 'x', index, onSettle: (page) => dispatch({ type: 'space', id: SPACES[page].id }) });

  return (
    <Sidebar collapsible={collapsible}>
      <SpaceHeader />
      {/* Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility. */}
      <SidebarContent ref={pager} style={{ scrollbarWidth: 'none' }} className="snap-x snap-mandatory flex-row gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain">
        {/* Every space stays mounted so neighbours show mid-swipe; window to index ± 1 if the space count grows. */}
        {SPACES.map((s, i) => (
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
  return (
    <SidebarHeader className="h-11 flex-row items-center gap-1.5 py-0 pr-2 pl-2 md:pl-9.5 md:in-data-traffic-lights:pl-29.5">
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
                <Shortcut keys={['mod', 'K']} className="hidden md:inline-flex" />
              }
            />
            <NavItem icon={<Edit />} label="New thread" isActive={view.kind === 'new'} onClick={() => go({ kind: 'new' })} trailing={<Kbd className="hidden md:inline-flex">N</Kbd>} />
            <NavItem icon={<Inbox />} label="Queue" isActive={view.kind === 'queue'} onClick={() => go({ kind: 'queue' })} badge={queue.length > 0 ? queue.length : undefined} />
            {review.count > 0 && <NavItem icon={<TaskSquare />} label="Review" isActive={review.isOpen} onClick={review.open} badge={review.count} />}
            <NotificationBell spaceId={spaceId} />
            <NavItem icon={<Route />} label="Board" isActive={view.kind === 'board'} onClick={() => go({ kind: 'board' })} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* `contents` keeps the groups' own layout; it only collects Esc and Shift ↑/↓ from every thread row. */}
      <div className="contents" onKeyDown={selection.onKeyDown}>
        <ThreadList pinned={pinned} active={active} row={row} selectedIds={selection.ids} />

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
                      <ThreadRowMenu key={t.id} threadId={t.id} selectedIds={selection.ids}>
                        <SidebarMenuItem data-thread-row={t.id}>{row(t)}</SidebarMenuItem>
                      </ThreadRowMenu>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        )}
      </div>
    </>
  );
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

/** Pinned and active threads, split by the Threads label. Drag a row across the label to pin or unpin, within a section to reorder, or out onto a split to open it there. Alt ↑/↓ does the same from the keyboard. */
function ThreadList({ pinned, active, row, selectedIds }: { pinned: Thread[]; active: Thread[]; row: (t: Thread) => ReactNode; selectedIds: string[] }) {
  const { dispatch } = useHarness();
  const listRef = useRef<HTMLUListElement>(null);
  const pinnedIds = pinned.map((t) => t.id);
  const activeIds = active.map((t) => t.id);
  const reorder = (lists: { pinned: string[]; unpinned: string[] } | null) => lists && dispatch({ type: 'reorder', ...lists });
  const drag = useRowDrag(listRef, pinnedIds, reorder);
  if (pinned.length + active.length === 0) return null;

  const dragged = drag.state && [...pinned, ...active].find((t) => t.id === drag.state!.id);
  const step = (id: string, by: 1 | -1) => {
    reorder(stepPin(pinnedIds, activeIds, id, by));
    // Moving a focused node in the DOM can drop its focus; put it back on the row.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-sidebar=menu-button]`)?.focus());
  };
  const section = (threads: Thread[], isPinned: boolean) => {
    const rows = threads.filter((t) => t.id !== drag.state?.id).map((t, i) => {
      const item = (
        <ThreadRowMenu key={t.id} threadId={t.id} selectedIds={selectedIds}>
          <SidebarMenuItem
            data-row-id={t.id}
            data-thread-row={t.id}
            data-pinned={isPinned || undefined}
            onPointerDown={(e) => drag.onPointerDown(e, t)}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              step(t.id, e.key === 'ArrowUp' ? -1 : 1);
            }}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          >
            {row(t)}
          </SidebarMenuItem>
        </ThreadRowMenu>
      );
      if (!isPinned) return item;
      return (
        <ThreadPeek key={t.id} thread={t} pinNumber={i + 1} isDisabled={!!drag.state}>
          {item}
        </ThreadPeek>
      );
    });
    const slot = drag.state?.slot;
    if (slot && slot.toPinned === isPinned) rows.splice(slot.index, 0, <DropPlaceholder key="placeholder" height={drag.state!.height} />);
    return rows;
  };
  const showPinned = pinned.length > 0 || !!drag.state;
  const isPinnedEmpty = pinned.filter((t) => t.id !== drag.state?.id).length === 0 && drag.state?.slot?.toPinned !== true;

  return (
    <SidebarGroup>
      <SidebarMenu ref={listRef} className="select-none">
        {showPinned && (
          <li>
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
          </li>
        )}
        {section(pinned, true)}
        {!!drag.state && isPinnedEmpty && (
          <li aria-hidden className="mx-2 flex h-9 items-center justify-center rounded-md border border-dashed type-caption text-subtle-foreground">
            Drop here to pin
          </li>
        )}
        <li data-threads-label className="mt-3">
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
        </li>
        {section(active, false)}
      </SidebarMenu>
      {!!drag.state && !!dragged && <RowGhost thread={dragged} drag={drag.state} />}
    </SidebarGroup>
  );
}

function DropPlaceholder({ height }: { height: number }) {
  return (
    <li aria-hidden className="relative" style={{ height }}>
      <span className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-foreground/40" />
    </li>
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
function useRowDrag(listRef: React.RefObject<HTMLUListElement | null>, pinnedIds: string[], onReorder: (lists: ReturnType<typeof dropPin>) => void) {
  const { state, dispatch } = useHarness();
  const { isMobile } = useSidebar();
  const [drag, setDrag] = useState<RowDragState | null>(null);
  const latest = useRef({ pinnedIds, state, onReorder });
  latest.current = { pinnedIds, state, onReorder };

  const onPointerDown = (e: React.PointerEvent<HTMLLIElement>, thread: Thread) => {
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
        startDrag({ kind: 'thread', id: thread.id }, thread.title, ev.clientX, ev.clientY, true);
        document.documentElement.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
        frame = requestAnimationFrame(autoScroll);
      }
      moveDrag(ev.clientX, ev.clientY);
      update({ id: thread.id, x: ev.clientX, y: ev.clientY, width: rect.width, height: rect.height, grabX: start.x - rect.left, grabY: start.y - rect.top, slot: slotAt(listRef.current, thread.id, latest.current.pinnedIds, ev.clientX, ev.clientY) });
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
      const landed = endDrag();
      const { slot } = current;
      setDrag(null);
      if (isCancel) return;
      if (landed) return dispatch({ type: 'layout-drop', leafId: landed.leafId, zone: landed.zone, view: landed.view });
      if (!slot) return;
      const { state: s, onReorder: reorder } = latest.current;
      const pinned = pinnedThreads(s.threads, s.spaceId).map((t) => t.id);
      const unpinned = activeThreads(s.threads, s.spaceId).map((t) => t.id);
      reorder(dropPin(pinned, unpinned, thread.id, slot.toPinned, slot.index));
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
 * Above the Threads label is Pinned; a full Pinned sends the row to the top of Threads.
 */
function slotAt(list: HTMLUListElement | null, draggedId: string, pinnedIds: string[], x: number, y: number): RowDragState['slot'] {
  if (!list) return null;
  const box = list.getBoundingClientRect();
  if (x < box.left - LIST_SLACK_PX || x > box.right + LIST_SLACK_PX) return null;
  const label = list.querySelector('[data-threads-label]')!.getBoundingClientRect();
  const isFull = pinnedIds.filter((id) => id !== draggedId).length >= PIN_SLOTS.length;
  const toPinned = y < label.top + label.height / 2 && !isFull;
  const rows = [...list.querySelectorAll<HTMLElement>(toPinned ? '[data-row-id][data-pinned]' : '[data-row-id]:not([data-pinned])')];
  const index = rows.filter((r) => {
    const rr = r.getBoundingClientRect();
    return rr.top + rr.height / 2 < y;
  }).length;
  return { toPinned, index };
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

function ThreadItem({ thread, isActive, isSelected, onSelect }: { thread: Thread; isActive: boolean; isSelected?: boolean; onSelect: (e: ReactMouseEvent) => void }) {
  const row = useThreadRow(thread);
  const { isSettled, toggle: settle } = useSettle(thread);
  const pr = thread.prs[thread.prs.length - 1];
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
          {thread.repo ? (
            <>
              <ProjectAvatar name={thread.repo.project} />
              <span className="shrink-0">{thread.repo.project}</span>
              <span className="min-w-0 truncate">{thread.repo.branch}</span>
            </>
          ) : (
            <>
              <ChatRound className="size-4 shrink-0" />
              <span className="shrink-0">No project</span>
            </>
          )}
          {/* While the Settle / Reactivate chip covers this slot, it widens to the chip's width so the branch truncates before the chip instead of under it. */}
          <span className={cn('ml-auto shrink-0 tabular transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0', isSettled ? 'group-focus-within/menu-item:min-w-20 group-hover/menu-item:min-w-20' : 'group-focus-within/menu-item:min-w-14 group-hover/menu-item:min-w-14')}>{row.ago}</span>
        </span>
        <span className={cn('min-w-0 truncate', isActive && 'text-foreground')}>{thread.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 type-caption text-subtle-foreground">
          <ProgressRing pct={row.pct} slot={thread.line} size={12} />
          <span className="shrink-0 tabular">{Math.round(row.pct * 100)}%</span>
          <span className="min-w-0 flex-1 truncate">{row.detail}</span>
          {row.isWatched && <Eye aria-label="Watched" className="size-3 shrink-0" />}
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
  return { pct, detail, ago: minutes < 1 ? 'now' : duration(minutes), needsYou: thread.status === 'needs-you', isWatched: state.watched.includes(thread.id) };
}

export function threadDetail(thread: Thread, question?: string) {
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
                {s.name} <Shortcut keys={['nav', String(i + 1)]} className="ml-1" />
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
          <OverflowIcon />
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
