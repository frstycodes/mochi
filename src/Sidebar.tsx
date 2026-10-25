import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { motion } from 'motion/react';
import { useDraggable } from '@dnd-kit/react';
import {
  Archive,
  Chat,
  Eye,
  Menu,
  Plus,
  Search,
  TaskSquare,
  Unarchive,
} from '@/icons';
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { PrStack } from './git/PrStack';
import { SubThreadGuide } from './goals/SubThreads';
import { nestWithUndo, unnestWithUndo } from './subThreadActions';
import { PIN_SLOTS, type Thread } from './model';
import { useProfiles } from './profiles';
import {
  cancelDrag,
  DragSurface,
  endDrag,
  MENTION_DROP_EVENT,
  mentionDropAt,
  moveDrag,
  startDrag,
  type SurfaceHandlers,
} from './layout/drag';
import { DragGhost } from './DragGhost';
import { DropLine } from './DropLine';
import { ThreadPeek } from './layout/ThreadPeek';
import { ThreadRowMenu } from './menus/ThreadRowMenu';
import { useIsMultiSplit } from './SidebarToggle';
import {
  extendSelection,
  selectRange,
  toggleSelected,
  type Selection,
} from './selection';
import { isMod } from './keys';
import { NotificationBell } from './notify/NotificationBell';
import {
  dropAt,
  dropPin,
  lastActivityAt,
  nestBlocker,
  orderBetween,
  rootOf,
  pinnedThreads,
  pinOrderOf,
  sidebarGroups,
  stepPin,
  type DropAt,
  type ThreadGroup,
} from './reorder';
import { SidebarResizer } from './SidebarResizer';
import { NavItem, SidebarNav } from './SidebarNav';
import { useSettle } from './useSettle';
import { NextRunBadge } from './schedule/NextRunBadge';
import { useReviewEntry } from './review/useReviewMode';
import { useSnapPager } from './useSnapPager';
import { haptic } from './haptic';
import {
  useDispatch,
  useGetState,
  useHarnessSelector,
  useSpace,
  useSpaceListing,
  useSpaceQueue,
  useThread,
  useView,
  type State,
  type View,
} from './store';
import {
  endRename,
  startRename,
  titleToSave,
  useRenameSurface,
} from './rename';
import type { FollowedMachine } from './host/types/remote';
import { SpaceIcon, TooltipIconButton } from './ui';
import {
  AgentsBadge,
  ThreadStatusDot,
  useThreadRow,
  type ThreadRow,
} from './threadRow';
import { BoundShortcut } from './Shortcut';
import { spaceCommand } from './keymap';
import { remoteDecisions, remoteThreads } from './remote/mirror';
import { openRemoteThread, useRemoteThreadRoute } from './routes/nav';
import { DeviceIcon } from './remote/DeviceIcon';
import { MachinePresence } from './remote/MachinePresence';
import { RemoteScope, useMachines } from './remote/useMachines';
import { UserMenu } from './UserMenu';
import { FoldGroup } from './SidebarFold';
import { ProjectIcon } from './ProjectIcon';
import { useProjectAt } from './projects';
import { HAS_CAPTIONS } from './windowCaptions';
import { host } from './host';

export function AppSidebar({
  onSearch,
  collapsible,
  width,
  onResize,
}: {
  onSearch: () => void;
  collapsible?: 'offcanvas' | 'icon' | 'none';
  width?: number;
  onResize?: (px: number) => void;
}) {
  const dispatch = useDispatch();
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const profiles = useProfiles();
  const index = profiles.findIndex((s) => s.id === spaceId);
  const pager = useRef<HTMLDivElement>(null);
  useSnapPager(pager, {
    axis: 'x',
    index,
    onSettle: (page) => dispatch({ type: 'space', id: profiles[page].id }),
    onCross: haptic,
  });

  return (
    <Sidebar collapsible={collapsible}>
      <SpaceHeader />
      {/* Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility. */}
      <SidebarContent
        ref={pager}
        style={{ scrollbarWidth: 'none' }}
        className="snap-x snap-mandatory flex-row gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        {/* Every space stays mounted so neighbours show mid-swipe; window to index ± 1 if the space count grows. */}
        {profiles.map((s, i) => (
          <SpacePanel key={s.id} isCurrent={i === index}>
            <SpaceNav spaceId={s.id} onSearch={onSearch} />
          </SpacePanel>
        ))}
      </SidebarContent>
      <SpaceFooter />
      {width !== undefined && !!onResize && (
        <SidebarResizer width={width} onCommit={onResize} />
      )}
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

  const [wasCollapsed, setWasCollapsed] = useState(isCollapsed);
  if (isCollapsed !== wasCollapsed) {
    setWasCollapsed(isCollapsed);
    if (!isCollapsed) setOpen(false);
  }

  if (!isCollapsed && !isDocking) return null;
  const open = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const close = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => setOpen(false),
      PEEK_CLOSE_DELAY,
    );
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
      {!isDocking && (
        <div
          aria-hidden
          onPointerEnter={open}
          onPointerLeave={close}
          className="fixed inset-y-0 left-0 z-40 w-2"
        />
      )}
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
          !isDocking &&
            (isOpen
              ? 'translate-x-0 opacity-100 duration-[240ms]'
              : 'pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0 duration-200'),
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
      {!isMobile && !isMulti && (
        <SidebarTrigger className="ml-1 text-muted-foreground" />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex min-w-0 items-center gap-2 px-1">
            <SpaceIcon
              space={space}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate type-meta font-medium">{space.name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {[
            space.plans.claude && `Claude ${space.plans.claude}`,
            space.plans.codex && `Codex ${space.plans.codex}`,
            space.github && `GitHub ${space.github}`,
          ]
            .filter(Boolean)
            .join(' · ') || `${space.name} profile`}
        </TooltipContent>
      </Tooltip>
      <span className="ml-auto" />
      <NotificationBell spaceId={space.id} />
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
    <TooltipIconButton
      label="Menu"
      hint="File, Edit, View, Window"
      onClick={open}
      className="text-muted-foreground"
    >
      <Menu />
    </TooltipIconButton>
  );
}

function SpacePanel({
  isCurrent,
  children,
}: {
  isCurrent: boolean;
  children: ReactNode;
}) {
  return (
    <div
      inert={!isCurrent || undefined}
      className="flex w-full shrink-0 snap-start snap-always flex-col gap-2 overflow-y-auto overscroll-y-contain"
    >
      {children}
    </div>
  );
}

function SpaceNav({
  spaceId,
  onSearch,
}: {
  spaceId: string;
  onSearch: () => void;
}) {
  const dispatch = useDispatch();
  const view = useView(spaceId);
  const threads = useSpaceListing(spaceId);
  const queue = useSpaceQueue(spaceId);
  const remoteQueueCount = useMachines().machines.reduce(
    (n, m) => n + (m.state ? remoteDecisions(m.state).length : 0),
    0,
  );
  const review = useReviewEntry(spaceId);
  const { setOpenMobile } = useSidebar();
  const go = (v: View) => {
    dispatch({ type: 'go', view: v });
    setOpenMobile(false);
  };

  const { pinned, active } = sidebarGroups(threads, spaceId);
  const settled = threads.filter((t) => t.status === 'settled');
  const isActive = (t: Thread) => view.kind === 'thread' && view.id === t.id;
  const order = [
    ...[...pinned, ...active].flatMap((g) => [g.thread, ...g.subs]),
    ...settled,
  ].map((t) => t.id);
  const selection = useThreadSelection(
    order,
    view.kind === 'thread' ? view.id : undefined,
  );
  const row = (t: Thread, isSub = false) => (
    <ThreadItem
      thread={t}
      isSub={isSub}
      isActive={isActive(t)}
      isSelected={selection.ids.includes(t.id)}
      onSelect={(e) =>
        selection.onClick(e, t.id) && go({ kind: 'thread', id: t.id })
      }
      onRename={() => startRename(t.id, 'row')}
    />
  );

  return (
    <>
      <SidebarGroup className="pt-3">
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem
              icon={<Plus />}
              label="New"
              isActive={view.kind === 'new'}
              onClick={() => go({ kind: 'new' })}
              trailing={
                <BoundShortcut
                  command="go-new"
                  className="hidden md:inline-flex"
                />
              }
            />
            <NavItem
              icon={<Search />}
              label="Search"
              onClick={onSearch}
              trailing={
                <BoundShortcut
                  command="palette"
                  className="hidden md:inline-flex"
                />
              }
            />
            {review.count > 0 && (
              <NavItem
                icon={<TaskSquare />}
                label="Review"
                isActive={review.isOpen}
                onClick={review.open}
                badge={review.count}
              />
            )}
            <SidebarNav
              view={view}
              go={go}
              queueCount={queue.length + remoteQueueCount}
            />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* `contents` keeps the groups' own layout; it only collects Esc and Shift ↑/↓ from every thread row. */}
      <div className="contents" onKeyDown={selection.onKeyDown}>
        <ThreadList
          pinned={pinned}
          remotePins={useRemotePins()}
          active={active}
          row={row}
          selectedIds={selection.ids}
        />

        {settled.length > 0 && (
          <FoldGroup label="Archived" count={settled.length}>
            {settled.map((t) => (
              <ThreadRowMenu
                key={t.id}
                threadId={t.id}
                selectedIds={selection.ids}
              >
                <SidebarMenuItem data-thread-row={t.id}>
                  {row(t)}
                </SidebarMenuItem>
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
    const { active, settled } = state
      ? remoteThreads(state)
      : { active: [], settled: [] };
    const row = (t: Thread) => (
      <SidebarMenuItem key={t.id} data-remote-thread-row={t.id}>
        <ThreadItem
          thread={t}
          isActive={route?.machineId === machine.id && route.threadId === t.id}
          onSelect={() =>
            openRemoteThread({ machineId: machine.id, threadId: t.id })
          }
        />
      </SidebarMenuItem>
    );
    const label = (
      <SidebarGroupLabel className="gap-1.5">
        <DeviceIcon kind={machine.kind} className="size-3.5! shrink-0" />
        <span className="min-w-0 truncate">{machine.name}</span>
        <MachinePresence machine={machine} />
      </SidebarGroupLabel>
    );
    if (!state) return <SidebarGroup key={machine.id}>{label}</SidebarGroup>;
    // Archived folds below as its own group, level with the machine's, as this computer's own does.
    return (
      <RemoteScope key={machine.id} machine={machine} state={state}>
        <SidebarGroup>
          {label}
          <SidebarMenu>
            {active.map(row)}
            {active.length === 0 && (
              <li className="px-2 type-caption text-subtle-foreground">
                No active threads
              </li>
            )}
          </SidebarMenu>
        </SidebarGroup>
        {settled.length > 0 && (
          <FoldGroup label="Archived" count={settled.length}>
            {settled.map(row)}
          </FoldGroup>
        )}
      </RemoteScope>
    );
  });
}

/**
 * Finder-style selection over the space's thread rows: a plain click opens the thread and clears it, Shift-click selects a range
 * from the anchor, mod-click adds or removes one, Shift ↑/↓ extends from the focused row, Esc clears.
 */
function useThreadSelection(order: string[], openId: string | undefined) {
  const [selection, setSelection] = useState<Selection>({
    ids: [],
    anchor: undefined,
  });
  const current = {
    ids: selection.ids.filter((id) => order.includes(id)),
    anchor: selection.anchor ?? openId,
  };

  /** True when the click should open the thread. */
  const onClick = (e: ReactMouseEvent, id: string) => {
    if (e.shiftKey)
      return setSelection({
        ids: selectRange(order, current.anchor, id),
        anchor: current.anchor,
      });
    if (isMod(e)) return setSelection(toggleSelected(order, current, id));
    setSelection({ ids: [], anchor: id });
    return true;
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && current.ids.length > 0) {
      e.stopPropagation();
      return setSelection({ ids: [], anchor: undefined });
    }
    const id = (e.target as HTMLElement)
      .closest('[data-thread-row]')
      ?.getAttribute('data-thread-row');
    if (
      !id ||
      !e.shiftKey ||
      e.altKey ||
      (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
    )
      return;
    e.preventDefault();
    const next = extendSelection(
      order,
      {
        ids: current.ids,
        anchor: current.ids.length > 0 ? current.anchor : id,
      },
      id,
      e.key === 'ArrowUp' ? -1 : 1,
    );
    if (!next) return;
    setSelection(next.selection);
    e.currentTarget
      .querySelector<HTMLElement>(
        `[data-thread-row="${next.focusId}"] [data-sidebar=menu-button]`,
      )
      ?.focus();
  };
  return { ids: current.ids, onClick, onKeyDown };
}

/**
 * Pinned threads in your order (your other computers' among them), then the rest by recent activity, split by the Threads label;
 * sub-threads hang under their parent on an L-shaped guide. Drag a row across the label to pin or unpin, within Pinned to reorder,
 * out onto a split to open it there, or drag it right past the indent to nest it under the row above the line; drag a sub-thread out of its
 * group to make it a thread of its own. Alt ↑/↓ reorders from the keyboard, the row menu nests.
 */
function ThreadList({
  pinned,
  remotePins,
  active,
  row,
  selectedIds,
}: {
  pinned: ThreadGroup[];
  remotePins: RemotePin[];
  active: ThreadGroup[];
  row: (t: Thread, isSub?: boolean) => ReactNode;
  selectedIds: string[];
}) {
  const dispatch = useDispatch();
  const getState = useGetState();
  const { run } = useMachines();
  const route = useRemoteThreadRoute();
  const listRef = useRef<HTMLUListElement>(null);
  const pins = mergePins(pinned, remotePins);
  const pinnedIds = pinned.map((g) => g.thread.id);
  const activeIds = active.map((g) => g.thread.id);
  const reorder = (lists: { pinned: string[]; unpinned: string[] } | null) =>
    lists &&
    dispatch({
      type: 'reorder',
      ...lists,
      // oxlint-disable-next-line react/purity -- runs from drag and keyboard handlers (useRowDrag's onDragEnd, step), never during render
      at: Date.now(),
    });
  const drop = (dragged: ListRow, slot: NonNullable<RowDragState['slot']>) => {
    if (!dragged.remote && !slot.toPinned)
      return reorder(
        dropPin(pinnedIds, activeIds, dragged.thread.id, false, slot.index),
      );
    const others = pins.filter((p) => p.rowId !== dragged.rowId);
    const order = orderBetween(
      others[slot.index - 1] && pinOrderOf(others[slot.index - 1].thread),
      others[slot.index] && pinOrderOf(others[slot.index].thread),
      // oxlint-disable-next-line react/purity -- runs from drag and keyboard handlers (useRowDrag's onDragEnd, step), never during render
      Date.now(),
    );
    if (!dragged.remote)
      return dispatch({ type: 'pin-at', threadId: dragged.thread.id, order });
    void run(
      dragged.remote.machine.id,
      slot.toPinned
        ? { type: 'pin', threadId: dragged.thread.id, isPinned: true, order }
        : { type: 'pin', threadId: dragged.thread.id, isPinned: false },
    );
  };
  const nest = (dragged: ListRow, parentId: string) =>
    nestWithUndo(dispatch, getState().threads, dragged.thread, parentId);
  const rows = [...pins, ...active.map(localRow)];
  const findRow = (rowId: string) =>
    [
      ...rows,
      ...rows.flatMap((r) =>
        (r.subs ?? []).map((s) => localRow({ thread: s, subs: [] })),
      ),
    ].find((r) => r.rowId === rowId);
  const drag = useRowDrag(listRef, findRow, pinnedIds, drop, nest);
  const { isMobile } = useSidebar();
  const nestUnder = drag.state?.nestUnder;
  const target = useHarnessSelector(
    (s) => nestUnder && s.threads.find((t) => t.id === nestUnder),
  );
  if (pins.length + active.length === 0) return null;

  const dragged = drag.state && findRow(drag.state.id);
  const step = (id: string, by: 1 | -1) => {
    reorder(stepPin(pinnedIds, activeIds, id, by));
    // Moving a focused node in the DOM can drop its focus; put it back on the row.
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(
          `[data-row-id="${id}"] [data-sidebar=menu-button]`,
        )
        ?.focus(),
    );
  };
  const item = (
    t: Thread,
    pinNumber: number | undefined,
    rowProps: object,
    sub?: { parentId: string; isLast: boolean },
  ) => (
    <ThreadPeek
      key={t.id}
      thread={t}
      pinNumber={pinNumber}
      isDisabled={!!drag.state}
    >
      <ThreadRowMenu threadId={t.id} selectedIds={selectedIds}>
        <SidebarMenuItem
          asChild
          {...rowProps}
          data-thread-row={t.id}
          data-sub-of={sub?.parentId}
          onKeyDown={(e) => {
            if (
              sub ||
              !e.altKey ||
              (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
            )
              return;
            e.preventDefault();
            step(t.id, e.key === 'ArrowUp' ? -1 : 1);
          }}
          aria-keyshortcuts={sub ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
          className={cn(sub && 'pl-[27px]')}
        >
          <motion.li {...glide} layoutId={rowLayoutId(t.id)}>
            {!!sub && (
              <SubThreadGuide isLast={sub.isLast} className="left-[15px]" />
            )}
            {row(t, !!sub)}
          </motion.li>
        </SidebarMenuItem>
      </ThreadRowMenu>
    </ThreadPeek>
  );
  const section = (rows: ListRow[], isPinned: boolean) => {
    const items = rows
      .filter((r) => r.rowId !== drag.state?.id)
      .map((r) => {
        const t = r.thread;
        const rowProps = {
          'data-row-id': r.rowId,
          'data-pinned': isPinned || undefined,
        } as const;
        const subs = (r.subs ?? []).filter((s) => s.id !== drag.state?.id);
        if (r.remote)
          return (
            <SidebarMenuItem
              key={r.rowId}
              asChild
              {...rowProps}
              data-remote-thread-row={t.id}
            >
              <motion.li {...glide} layoutId={rowLayoutId(r.rowId)}>
                <RemoteScope machine={r.remote.machine} state={r.remote.state}>
                  <ThreadItem
                    thread={t}
                    machine={r.remote.machine}
                    isActive={
                      route?.machineId === r.remote.machine.id &&
                      route.threadId === t.id
                    }
                    onSelect={() =>
                      openRemoteThread({
                        machineId: r.remote!.machine.id,
                        threadId: t.id,
                      })
                    }
                  />
                </RemoteScope>
              </motion.li>
            </SidebarMenuItem>
          );
        // The number is this computer's Orbit slot: another computer's pins have their own there.
        const pinNumber = isPinned ? pinnedIds.indexOf(t.id) + 1 : undefined;
        // A dragged parent takes its sub-threads with it; a dragged sub-thread leaves its group's guide.
        return (
          <Fragment key={r.rowId}>
            {item(t, pinNumber, rowProps)}
            {subs.map((s, j) =>
              item(
                s,
                undefined,
                { 'data-row-id': s.id, 'data-pinned': isPinned || undefined },
                { parentId: t.id, isLast: j === subs.length - 1 },
              ),
            )}
          </Fragment>
        );
      });
    const slot = drag.state?.slot;
    // Threads sort by recency, so a row dropped there lands where its last activity puts it, not where the pointer is.
    // A nesting line stays under the row it nests under.
    const at =
      slot &&
      !isPinned &&
      dragged &&
      !dragged.thread.parent &&
      !drag.state!.nestUnder
        ? rows.filter(
            (r) =>
              r.rowId !== dragged.rowId &&
              lastActivityAt(r.thread) > lastActivityAt(dragged.thread),
          ).length
        : slot?.index;
    if (slot && slot.toPinned === isPinned)
      items.splice(
        at!,
        0,
        <DropLine
          key="placeholder"
          height={drag.state!.height}
          isNested={!!drag.state!.nestUnder}
          glide={glide}
        />,
      );
    return items;
  };
  const showPinned = pins.length > 0 || !!drag.state;
  // Rows only re-measure when the order or the drop slot changes, so ticks, scrolling and space swipes never animate them.
  const glide = {
    layout: 'position',
    layoutDependency: rowOrderKey(
      rows.flatMap((r) => [r.rowId, ...(r.subs ?? []).map((s) => s.id)]),
      activeIds,
      drag.state,
    ),
    transition: ROW_LAYOUT,
  } as const;
  const isPinnedEmpty =
    pins.filter((p) => p.rowId !== drag.state?.id).length === 0 &&
    drag.state?.slot?.toPinned !== true;

  return (
    <SidebarGroup>
      <DragSurface
        distance={DRAG_THRESHOLD}
        canStart={drag.canStart}
        autoScroll
        {...drag.handlers}
      >
        <SidebarMenu ref={listRef} className="relative select-none">
          {showPinned && (
            <motion.li {...glide}>
              <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            </motion.li>
          )}
          {section(pins, true)}
          {!!drag.state && isPinnedEmpty && (
            <motion.li
              {...glide}
              aria-hidden
              className="mx-2 flex h-9 items-center justify-center rounded-md border border-dashed type-caption text-subtle-foreground"
            >
              Drop here to pin
            </motion.li>
          )}
          <motion.li {...glide} data-threads-label className="mt-3">
            <SidebarGroupLabel>Threads</SidebarGroupLabel>
          </motion.li>
          {section(active.map(localRow), false)}
        </SidebarMenu>
        {/* After the list: its layout effect reads the list's ref, which React attaches in tree order. */}
        <ListDraggable listRef={listRef} isDisabled={isMobile} />
        <p role="status" className="sr-only">
          {target ? `Drop to make it a sub-thread of ${target.title}` : ''}
        </p>
        {!!drag.state && !!dragged && (
          <RowGhost
            thread={dragged.thread}
            drag={drag.state}
            layoutId={rowLayoutId(dragged.rowId)}
          />
        )}
      </DragSurface>
    </SidebarGroup>
  );
}

/** Another computer's pinned thread, shown in this computer's Pinned list. */
interface RemotePin {
  machine: FollowedMachine;
  state: State;
  thread: Thread;
}

/** A row of the thread list; another computer's carries where it runs, and a row id that can't clash with a thread here. A row here carries its sub-threads. */
interface ListRow {
  rowId: string;
  thread: Thread;
  remote?: RemotePin;
  subs?: Thread[];
}

const localRow = (group: ThreadGroup): ListRow => ({
  rowId: group.thread.id,
  ...group,
});

/** Every computer's pins as one list, by pin order (`pinOrderOf`); this computer's first among equal keys. */
function mergePins(pinned: ThreadGroup[], remotePins: RemotePin[]): ListRow[] {
  const rows = [
    ...pinned.map(localRow),
    ...remotePins.map((remote) => ({
      rowId: `${remote.machine.id}:${remote.thread.id}`,
      thread: remote.thread,
      remote,
    })),
  ];
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        pinOrderOf(a.row.thread) - pinOrderOf(b.row.thread) || a.i - b.i,
    )
    .map(({ row }) => row);
}

/** Your other computers' pinned threads, from what each last streamed. */
function useRemotePins(): RemotePin[] {
  return useMachines().machines.flatMap(({ machine, state }) =>
    state
      ? pinnedThreads(state.threads, state.spaceId).map((thread) => ({
          machine,
          state,
          thread,
        }))
      : [],
  );
}

function rowOrderKey(
  pinnedIds: string[],
  activeIds: string[],
  drag: RowDragState | null,
) {
  const slot = drag?.slot
    ? `${drag.slot.toPinned ? 'p' : 'u'}${drag.slot.index}`
    : '';
  return `${pinnedIds.join(',')}|${activeIds.join(',')}|${drag?.id ?? ''}|${slot}|${drag?.nestUnder ?? ''}`;
}

// Shared by a row and its drag ghost, so a dropped row glides from the ghost into its slot.
const rowLayoutId = (rowId: string) => `sidebar-row-${rowId}`;

function RowGhost({
  thread,
  drag,
  layoutId,
}: {
  thread: Thread;
  drag: RowDragState;
  layoutId: string;
}) {
  return (
    <DragGhost
      x={drag.x - drag.grabX}
      y={drag.y - drag.grabY}
      width={drag.width}
      grabX={drag.grabX}
      grabY={drag.grabY}
      layoutId={layoutId}
      className="rounded-md bg-sidebar text-sidebar-foreground"
    >
      <ul data-sidebar="menu" className="list-none">
        <SidebarMenuItem>
          <ThreadItem
            thread={thread}
            isActive={false}
            onSelect={() => undefined}
          />
        </SidebarMenuItem>
      </ul>
    </DragGhost>
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
  slot: DropAt['slot'];
  /** The row it nests under on drop: the one above the line, while the drag is indented. */
  nestUnder: string | null;
}

const DRAG_THRESHOLD = 5;
const LIST_SLACK_PX = 24;
// How far right of where it was picked up a row has to be dragged to nest: about the sub-thread indent.
const NEST_INDENT_PX = 24;

/**
 * Sidebar row drag: the placeholder slot from live row positions, nesting when dragged right by the indent (this computer's
 * rows only), edge auto-scroll, and a hand-off to the split drop zones once the pointer leaves the
 * sidebar. Its handlers and `canStart` go on the list's `DragSurface`.
 */
function useRowDrag(
  listRef: React.RefObject<HTMLUListElement | null>,
  findRow: (rowId: string) => ListRow | undefined,
  pinnedIds: string[],
  onDrop: (row: ListRow, slot: NonNullable<RowDragState['slot']>) => void,
  onNest: (row: ListRow, parentId: string) => void,
) {
  const dispatch = useDispatch();
  const getState = useGetState();
  const [drag, setDrag] = useState<RowDragState | null>(null);
  const pressed = useRef<HTMLElement | null>(null);
  const session = useRef<{
    row: ListRow;
    state: RowDragState;
    startX: number;
  } | null>(null);

  const update = (state: RowDragState) => {
    if (!session.current) return;
    session.current.state = state;
    setDrag(state);
  };
  const canStart = (target: Element) => {
    pressed.current = target.closest<HTMLElement>('[data-row-id]');
    return (
      !!pressed.current && !target.closest('[data-sidebar=menu-action], input')
    );
  };
  const handlers: SurfaceHandlers = {
    onDragStart: ({ operation }) => {
      const el = pressed.current;
      const row = el && findRow(el.dataset.rowId!);
      if (!row) return;
      const rect = el.getBoundingClientRect();
      const grab = operation.position.initial;
      const { x, y } = operation.position.current;
      // Another computer's thread opens over the app, never in one of this computer's splits.
      if (!row.remote)
        startDrag(
          { kind: 'thread', id: row.thread.id },
          row.thread.title,
          x,
          y,
          { hasOwnGhost: true },
        );
      session.current = {
        row,
        startX: grab.x,
        state: {
          id: row.rowId,
          x,
          y,
          width: rect.width,
          height: rect.height,
          grabX: grab.x - rect.left,
          grabY: grab.y - rect.top,
          slot: null,
          nestUnder: null,
        },
      };
      setDrag(session.current.state);
    },
    onDragMove: ({ operation }) => {
      const s = session.current;
      if (!s) return;
      const { x, y } = operation.position.current;
      if (!s.row.remote) moveDrag(x, y);
      const at = dropOver(
        listRef.current,
        s.row,
        pinnedIds,
        getState().threads,
        x,
        y,
        x - s.startX >= NEST_INDENT_PX,
      );
      update({
        ...s.state,
        x,
        y,
        slot: at?.slot ?? null,
        nestUnder: at?.nestUnder ?? null,
      });
    },
    onDragEnd: ({ canceled }) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      setDrag(null);
      if (canceled) return cancelDrag();
      const mentionDrop = s.row.remote
        ? null
        : mentionDropAt(s.state.x, s.state.y);
      const landed = s.row.remote ? null : endDrag();
      if (mentionDrop)
        return void mentionDrop.dispatchEvent(
          new CustomEvent(MENTION_DROP_EVENT, { detail: s.row.thread.id }),
        );
      if (landed) return dispatch({ type: 'layout-drop', ...landed });
      const { slot, nestUnder } = s.state;
      if (nestUnder) return onNest(s.row, nestUnder);
      if (!slot) return;
      if (s.row.thread.parent)
        unnestWithUndo(dispatch, getState().threads, s.row.thread);
      onDrop(s.row, slot);
    },
  };

  return { state: drag, canStart, handlers };
}

/** The list is the one draggable: a dragged row leaves the list for its ghost, so it can't be its own source. */
function ListDraggable({
  listRef,
  isDisabled,
}: {
  listRef: React.RefObject<HTMLUListElement | null>;
  isDisabled: boolean;
}) {
  useDraggable({ id: 'thread-rows', element: listRef, disabled: isDisabled });
  return null;
}

/** Whether the dragged row may become a sub-thread of `parentId`; another computer's row never nests. */
function canNestUnder(row: ListRow, parentId: string, threads: Thread[]) {
  return (
    !row.remote &&
    parentId !== row.thread.parent?.threadId &&
    parentId !== rootOf(threads, row.thread).id &&
    threads.some((t) => t.id === parentId) &&
    !nestBlocker(threads, row.thread.id, parentId)
  );
}

/**
 * Where the dragged row would go, from the rows as rendered (the placeholder included), so moving the placeholder never flips the
 * answer back. Positions come from `offsetTop` within the (relative) list, not `getBoundingClientRect`: rows gliding to their new
 * place carry a transform that would flip the slot mid-animation. Another computer's row only reorders, and counts only its own
 * five pins, so its machine decides. Null when the pointer is off the list.
 */
function dropOver(
  list: HTMLUListElement | null,
  row: ListRow,
  pinnedIds: string[],
  threads: Thread[],
  x: number,
  y: number,
  isIndented: boolean,
): DropAt | null {
  if (!list) return null;
  const box = list.getBoundingClientRect();
  if (x < box.left - LIST_SLACK_PX || x > box.right + LIST_SLACK_PX)
    return null;
  const label = list.querySelector<HTMLElement>('[data-threads-label]')!;
  const rows = [...list.querySelectorAll<HTMLElement>('[data-row-id]')].map(
    (el) => ({
      id: el.dataset.rowId!,
      top: el.offsetTop,
      height: el.offsetHeight,
      isPinned: el.dataset.pinned !== undefined,
      ...(el.dataset.subOf && { parentId: el.dataset.subOf }),
    }),
  );
  const isFull =
    !row.remote &&
    pinnedIds.filter((id) => id !== row.rowId).length >= PIN_SLOTS.length;
  const canNest = (parentId: string) => canNestUnder(row, parentId, threads);
  const root = row.remote ? row.thread : rootOf(threads, row.thread);
  return dropAt(
    rows,
    label.offsetTop + label.offsetHeight / 2,
    { id: row.rowId, ...(root.id !== row.thread.id && { parentId: root.id }) },
    y - box.top,
    isIndented,
    isFull,
    canNest,
  );
}

/**
 * A thread's sidebar row: its title and one status dot, then the project, what it's doing or why it stopped, and its badges.
 * `isSub`: a sub-thread under its parent, one line unless it asks for you. `machine`: the computer it runs on, for another
 * computer's thread among this one's (Pinned).
 */
export function ThreadItem({
  thread: listed,
  isSub,
  machine,
  isActive,
  isSelected,
  onSelect,
  onRename,
}: {
  thread: Thread;
  isSub?: boolean;
  machine?: FollowedMachine;
  isActive: boolean;
  isSelected?: boolean;
  onSelect: (e: ReactMouseEvent) => void;
  onRename?: () => void;
}) {
  const thread = useThread(listed.id) ?? listed;
  const row = useThreadRow(thread);
  const { isSettled, toggle: settle } = useSettle(thread);
  const isRenaming = useRenameSurface(thread.id) === 'row';
  const asks = row.tone === 'warning' || row.tone === 'destructive';
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {isRenaming ? (
          <RowTitleField thread={thread} />
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              (isActive || row.isUnread) && 'text-foreground',
            )}
          >
            {thread.title}
          </span>
        )}
        {isSub && <PrStack thread={thread} />}
        {!isRenaming && (
          <ThreadStatusDot
            row={row}
            isActive={isActive}
            className="group-focus-within/menu-item:hidden group-hover/menu-item:hidden"
          />
        )}
        {/* Room for the Archive / Unarchive button while it shows, so the title truncates before the button instead of under it. */}
        {!isRenaming && (
          <span
            aria-hidden
            className="shrink-0 group-focus-within/menu-item:min-w-5 group-hover/menu-item:min-w-5"
          />
        )}
      </span>
      {isSub ? (
        asks && (
          <span
            className={cn(
              'truncate type-caption',
              row.tone === 'destructive' ? 'text-destructive' : 'text-warning',
            )}
          >
            {row.detail}
          </span>
        )
      ) : (
        <RowDetail thread={thread} row={row} machine={machine} />
      )}
    </>
  );
  return (
    <>
      {/* Renaming, the row is a div: a field inside a button would click and key through to it. */}
      <SidebarMenuButton
        asChild={isRenaming}
        isActive={isActive}
        data-selected={isSelected || undefined}
        aria-description={isSelected ? 'Selected' : undefined}
        onClick={isRenaming ? undefined : onSelect}
        onDoubleClick={onRename}
        tooltip={isRenaming ? undefined : thread.title}
        className={cn(
          'h-auto flex-col items-stretch gap-1 py-2 group-has-data-[sidebar=menu-action]/menu-item:pr-2 data-selected:bg-sidebar-accent',
          isSub && 'gap-0.5 px-1 py-1.5',
        )}
      >
        {isRenaming ? <div>{body}</div> : body}
      </SidebarMenuButton>
      {!isRenaming && (
        <SidebarMenuAction
          showOnHover
          asChild
          className="top-1.5! right-2 size-5 bg-sidebar bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-accent))] [&>svg]:size-3.5"
        >
          <TooltipIconButton
            label={isSettled ? 'Unarchive' : 'Archive'}
            hint={
              isSettled
                ? 'Moves it back to the active list.'
                : 'Stops its agent, terminals and dev servers, and files it under Archived.'
            }
            onClick={settle}
          >
            {isSettled ? <Unarchive /> : <Archive />}
          </TooltipIconButton>
        </SidebarMenuAction>
      )}
    </>
  );
}

/** The row's title as a field: Enter or leaving it saves, Esc keeps the old title. */
function RowTitleField({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const [startedFrom] = useState(thread.title);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and Esc end it, and the field's unmount then blurs it: once is enough.
  const isDone = useRef(false);
  // After the menu that started the rename has closed and handed focus back to the row.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const finish = (text: string | null) => {
    if (isDone.current) return;
    isDone.current = true;
    const title = text === null ? undefined : titleToSave(startedFrom, text);
    if (title) dispatch({ type: 'rename', threadId: thread.id, title });
    endRename();
  };
  return (
    <Input
      ref={ref}
      defaultValue={thread.title}
      aria-label="Thread title"
      maxLength={120}
      onBlur={(e) => finish(e.currentTarget.value)}
      // The row drags, reorders on Alt ↑/↓ and clears its selection on Esc: none of that while typing.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        const row = e.currentTarget.closest('[data-thread-row]');
        finish(e.key === 'Enter' ? e.currentTarget.value : null);
        // The row turns back into a button: keep the keyboard on it.
        requestAnimationFrame(() =>
          row
            ?.querySelector<HTMLElement>('[data-sidebar=menu-button]')
            ?.focus(),
        );
      }}
      className="-mx-[5px] h-5 flex-1 rounded-md px-1 py-0 text-foreground"
    />
  );
}

/** A top-level row's second line: where it runs (another computer's), the project's icon, what it's doing or why it stopped, its badges. */
function RowDetail({
  thread,
  row,
  machine,
}: {
  thread: Thread;
  row: ThreadRow;
  machine?: FollowedMachine;
}) {
  const project = useProjectAt(thread.spaceId, thread.repo?.path);
  // overflow-visible: the PR discs are 4px taller than the line, and the button truncates its last line.
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-visible! type-caption text-subtle-foreground">
      {!!machine && (
        <>
          <DeviceIcon kind={machine.kind} className="size-3.5 shrink-0" />
          <span className="sr-only">On {machine.name}</span>
        </>
      )}
      <span
        className="flex size-3.5 shrink-0 items-center justify-center [&>*]:scale-[0.875]"
        title={thread.repo?.project ?? 'No project'}
      >
        {thread.repo ? (
          <ProjectIcon name={thread.repo.project} icon={project?.icon} />
        ) : (
          <Chat aria-label="No project" className="size-4 shrink-0" />
        )}
      </span>
      {row.isWorking ? (
        <Shimmer as="span" className="min-w-0 flex-1 truncate">
          {row.detail}
        </Shimmer>
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            row.tone === 'warning' && 'text-warning',
            row.tone === 'destructive' && 'text-destructive',
          )}
        >
          {row.detail}
        </span>
      )}
      {row.isWatched && (
        <Eye aria-label="Watched" className="size-3 shrink-0" />
      )}
      <PrStack thread={thread} />
      <AgentsBadge thread={thread} />
      <NextRunBadge threadId={thread.id} />
    </span>
  );
}

function SpaceFooter() {
  const dispatch = useDispatch();
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const profiles = useProfiles();
  return (
    <SidebarFooter className="flex-row items-center gap-1 px-2 py-2">
      <UserMenu />
      <span className="flex-1" />
      <div
        role="radiogroup"
        aria-label="Profile"
        className="flex items-center gap-0.5"
      >
        {profiles.map((s, i) => {
          const isCurrent = s.id === spaceId;
          return (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isCurrent}
                  aria-label={`${s.name} profile`}
                  onClick={() => dispatch({ type: 'space', id: s.id })}
                  className={cn(
                    'flex size-7 cursor-default items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                    isCurrent && 'bg-sidebar-accent text-foreground',
                  )}
                >
                  <SpaceIcon space={s} className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {s.name}{' '}
                <BoundShortcut command={spaceCommand(i + 1)} className="ml-1" />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </SidebarFooter>
  );
}
