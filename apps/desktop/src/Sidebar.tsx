import {
  Fragment,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { motion } from 'motion/react';
import { useDraggable } from '@dnd-kit/react';
import { Archive, Eye, Menu, Plus, Search, Settings, Unarchive } from '@/icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
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
import { cn } from '@/lib/utils';
import { PrStack } from './git/PrStack';
import { SubThreadGuide } from './goals/SubThreads';
import { nestWithUndo, unnestWithUndo } from './subThreadActions';
import { PIN_SLOTS, type Space, type Thread } from './model';
import { MAX_PROFILES, useProfiles } from './profiles';
import { NewProfileDialog } from './settings/sections/profiles';
import { AgentSettingsProvider } from './settings/AgentSettings';
import { SpaceEditor } from './SpaceEditor';
import { SpaceHalo } from './SpaceHalo';
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
import { LightsStandIn, placeLights } from './trafficLights';
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
  flattenGroups,
  lastActivityAt,
  nestBlocker,
  orderBetween,
  rootOf,
  pinOrderOf,
  stepPin,
  type DropAt,
  type ThreadGroup,
} from './reorder';
import { SidebarResizer } from './SidebarResizer';
import { NavItem, SidebarNav } from './SidebarNav';
import { useSettle } from './useSettle';
import { NextRunBadge } from './schedule/NextRunBadge';
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
  type View,
} from './store';
import {
  endRename,
  startRename,
  titleToSave,
  useRenameSurface,
} from './rename';
import { parseRemoteThreadId } from './remote/ids';
import { MergedScope } from './remote/MergedScope';
import { MochiMark, SpaceIcon, StatusMark, TooltipIconButton } from './ui';
import {
  AgentsBadge,
  SnoozeAction,
  ThreadDetailText,
  ThreadTitleText,
  ThreadProjectMark,
  rowStatusMark,
  useThreadRow,
  type ThreadRow,
} from './threadRow';
import { BoundShortcut } from './Shortcut';
import { spaceCommand } from './keymap';
import { openSubpage } from './routes/nav';
import { ThreadMachineMark } from './remote/MachineMark';
import { UserMenu } from './UserMenu';
import { FoldGroup } from './SidebarFold';
import { filteredSidebarLists, useProjectFilter } from './projectFilter';
import { ProjectFilterMenu } from './ProjectFilterMenu';
import { MachineFilterMenu } from './MachineFilterMenu';
import { useMachineFilter } from './backends/machineFilter';
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
  const space = useSpace();
  const profiles = useProfiles();
  const index = profiles.findIndex((s) => s.id === spaceId);
  const pager = useRef<HTMLDivElement>(null);
  const [isEditing, setEditing] = useState(false);
  const [isAdding, setAdding] = useState(false);
  const addProfile =
    profiles.length < MAX_PROFILES ? () => setAdding(true) : undefined;
  useSnapPager(pager, {
    axis: 'x',
    index,
    onSettle: (page) => dispatch({ type: 'space', id: profiles[page].id }),
    onCross: haptic,
  });

  return (
    <Sidebar collapsible={collapsible}>
      {profiles.length > 1 && (
        <SpaceHalo profiles={profiles} currentId={spaceId} />
      )}
      <ContextMenu>
        {/* `contents`: the header, list and footer stay the sidebar's own flex children. */}
        <ContextMenuTrigger asChild>
          <div className="contents">
            <SpaceHeader />
            {/* Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility. */}
            <SidebarContent
              ref={pager}
              style={{ scrollbarWidth: 'none' }}
              className="relative snap-x snap-mandatory flex-row gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
            >
              {/* Every space stays mounted so neighbours show mid-swipe; window to index ± 1 if the space count grows. */}
              <MergedScope>
                {profiles.map((s, i) => (
                  <SpacePanel key={s.id} isCurrent={i === index}>
                    <SpaceNav spaceId={s.id} onSearch={onSearch} />
                  </SpacePanel>
                ))}
              </MergedScope>
            </SidebarContent>
            <SpaceFooter
              isEditing={isEditing}
              onEditingChange={setEditing}
              onAdd={addProfile}
            />
          </div>
        </ContextMenuTrigger>
        <SidebarContextMenu
          space={space}
          onEdit={() => setEditing(true)}
          onAdd={addProfile}
        />
      </ContextMenu>
      {/* Settings mounts this provider only while it's open; duplicating a profile needs its accounts. */}
      {isAdding && (
        <AgentSettingsProvider isDetecting={false}>
          <NewProfileDialog
            open
            onClose={() => setAdding(false)}
            onCreated={(profile) => {
              dispatch({ type: 'space', id: profile.id });
              setEditing(true);
            }}
          />
        </AgentSettingsProvider>
      )}
      {width !== undefined && !!onResize && (
        <SidebarResizer width={width} onCommit={onResize} />
      )}
    </Sidebar>
  );
}

const PEEK_CLOSE_DELAY = 240;
const PEEK_OPEN_MS = 240;
// The sidebar header's height in CSS px: the peek's drag region, with the traffic lights in its corner.
const HEADER_PX = 44;
// Outlasts the 160ms morph and the chat's 260ms slide; the docked sidebar underneath is identical, so lingering costs nothing.
const DOCK_MS = 300;

/** Arc-style: with the sidebar collapsed, resting on the left edge slides it back in as a floating panel. Its own toggle docks it in place: the panel grows to the window edge and loses its corners while the chat makes room behind it, then the docked sidebar takes over underneath. */
export function SidebarPeek({ onSearch }: { onSearch: () => void }) {
  const { state, isMobile, setOpen: setSidebarOpen } = useSidebar();
  const [isOpen, setOpen] = useState(false);
  const [isDocking, setDocking] = useState(false);
  const closeTimer = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const isCollapsed = state === 'collapsed' && !isMobile;

  const [wasCollapsed, setWasCollapsed] = useState(isCollapsed);
  if (isCollapsed !== wasCollapsed) {
    setWasCollapsed(isCollapsed);
    if (!isCollapsed) setOpen(false);
  }

  // At most one pending close: pointermove asks on every move.
  const scheduleClose = () => {
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = 0;
      setOpen(false);
    }, PEEK_CLOSE_DELAY);
  };

  // Collapsed, the traffic lights live in the peek: hidden while it's away, in its header corner once it has slid in.
  useEffect(() => {
    if (!isCollapsed) {
      placeLights('header');
      return;
    }
    if (!isOpen) {
      placeLights('hidden');
      return;
    }
    const timer = window.setTimeout(() => placeLights('peek'), PEEK_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [isCollapsed, isOpen]);
  useEffect(() => () => placeLights('header'), []);

  const closeOutside = useEffectEvent((e: PointerEvent) => {
    const target = e.target as Node;
    if (!panel.current?.contains(target) && !zone.current?.contains(target))
      scheduleClose();
  });
  // Leaving into the header's drag region (or onto the lights) is ignored below, and the page sees nothing more until the
  // pointer comes back: if it comes back anywhere but the peek, that was the way out.
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('pointermove', closeOutside);
    return () => window.removeEventListener('pointermove', closeOutside);
  }, [isOpen]);

  if (!isCollapsed && !isDocking) return null;
  const open = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = 0;
    setOpen(true);
  };
  const close = (e: ReactPointerEvent) => {
    // A drag region swallows pointer events, and the native lights aren't the page's: either reads as leaving the page,
    // though the pointer is still on the peek's header.
    const rect = panel.current?.getBoundingClientRect();
    if (
      rect &&
      e.clientX > rect.left &&
      e.clientX < rect.right &&
      e.clientY > rect.top &&
      e.clientY < rect.top + HEADER_PX
    )
      return;
    scheduleClose();
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
          ref={zone}
          aria-hidden
          onPointerEnter={open}
          onPointerLeave={close}
          className="app-no-drag fixed inset-y-0 left-0 z-40 w-2"
        />
      )}
      <div
        ref={panel}
        onPointerEnter={open}
        onPointerLeave={close}
        onClickCapture={dock}
        inert={(!isOpen && !isDocking) || undefined}
        className={cn(
          'app-no-drag fixed z-40 w-(--sidebar-width) overflow-hidden border-r bg-sidebar ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity',
          isDocking
            ? 'inset-y-0 left-0 rounded-none border-sidebar-border shadow-none transition-[top,bottom,left,border-radius,border-color,box-shadow] duration-[160ms]'
            : 'inset-y-2 left-2 rounded-xl border-transparent shadow-float transition-[translate,opacity]',
          !isDocking &&
            (isOpen
              ? 'translate-x-0 opacity-100 duration-[240ms]'
              : 'pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0 duration-200'),
        )}
      >
        <LightsStandIn />
        <AppSidebar onSearch={onSearch} collapsible="none" />
      </div>
    </>
  );
}

function SpaceHeader() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const { isMobile } = useSidebar();
  const isMulti = useIsMultiSplit();
  return (
    <SidebarHeader className="app-drag h-11 flex-row items-center gap-1.5 py-0 pr-2 pl-2 md:in-data-traffic-lights:pl-[calc(var(--lights-end)+5px)]">
      {HAS_CAPTIONS && <AppMenuButton />}
      {!isMobile && !isMulti && (
        <SidebarTrigger className="ml-1 text-muted-foreground" />
      )}
      <MochiMark className="ml-1 h-4" />
      <span className="ml-auto" />
      <NotificationBell spaceId={spaceId} />
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
  const { setOpenMobile } = useSidebar();
  const go = (v: View) => {
    dispatch({ type: 'go', view: v });
    setOpenMobile(false);
  };

  const projectFilter = useProjectFilter(spaceId, threads);
  const machineFilter = useMachineFilter();
  const {
    pinned,
    active,
    settled: allSettled,
  } = filteredSidebarLists(threads, spaceId, projectFilter.selected);
  const settled = allSettled.slice(0, SIDEBAR_SETTLED);
  const isActive = (t: Thread) => view.kind === 'thread' && view.id === t.id;
  const order = [...flattenGroups([...pinned, ...active]), ...settled].map(
    (t) => t.id,
  );
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
      <SidebarGroup className="-mb-1 pt-1 pb-0">
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
            <SidebarNav view={view} go={go} queueCount={queue.length} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* `contents` keeps the groups' own layout; it only collects Esc and Shift ↑/↓ from every thread row. */}
      <div className="contents" onKeyDown={selection.onKeyDown}>
        <ThreadList
          pinned={pinned}
          active={active}
          row={row}
          selectedIds={selection.ids}
          filterMenu={
            <div className="absolute top-1.5 right-3 z-10 flex gap-0.5">
              <MachineFilterMenu filter={machineFilter} />
              <ProjectFilterMenu spaceId={spaceId} filter={projectFilter} />
            </div>
          }
          isFiltered={
            projectFilter.selected !== null || machineFilter.selected.length > 0
          }
        />

        {settled.length > 0 && (
          <FoldGroup label="Settled" count={allSettled.length}>
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
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view.kind === 'settled'}
                onClick={() => go({ kind: 'settled' })}
                className="h-7 type-caption text-muted-foreground"
              >
                {allSettled.length > settled.length
                  ? `View all ${allSettled.length}`
                  : 'View all'}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </FoldGroup>
        )}
      </div>
    </>
  );
}

/** The newest settled threads the sidebar lists; View all opens the rest on the Settled page. */
const SIDEBAR_SETTLED = 10;

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ROW_LAYOUT = { duration: 0.2, ease: EASE_OUT };

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
 * Pinned threads in your order (your other computers' among them, pinned on this screen), then the rest by recent activity, split by the Threads label;
 * sub-threads hang under their parent on an L-shaped guide. Drag a row across the label to pin or unpin, within Pinned to reorder,
 * out onto a split to open it there, or drag it right past the indent to nest it under the row above the line; drag a sub-thread out of its
 * group to make it a thread of its own. Alt ↑/↓ reorders from the keyboard, the row menu nests.
 */
function ThreadList({
  pinned,
  active,
  row,
  selectedIds,
  filterMenu,
  isFiltered,
}: {
  pinned: ThreadGroup[];
  active: ThreadGroup[];
  row: (t: Thread, isSub?: boolean) => ReactNode;
  selectedIds: string[];
  filterMenu: ReactNode;
  isFiltered: boolean;
}) {
  const dispatch = useDispatch();
  const getState = useGetState();
  const listRef = useRef<HTMLUListElement>(null);
  const pins = pinned.map(localRow);
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
    if (!slot.toPinned)
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
    dispatch({ type: 'pin-at', threadId: dragged.thread.id, order });
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
  if (pins.length + active.length === 0)
    return isFiltered && <NoFilteredThreads filterMenu={filterMenu} />;

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
        // The number is the pin's place in Pinned, other computers' threads among them (mod 1–5).
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
      {filterMenu}
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
          <motion.li {...glide} data-threads-label className="mt-6">
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

/** A row of the thread list and its sub-threads. */
interface ListRow {
  rowId: string;
  thread: Thread;
  subs?: Thread[];
}

/** Another computer's thread (a machine-aware id): it never nests, nor drops into a composer as a mention. */
const isRemoteRow = (row: ListRow) => !!parseRemoteThreadId(row.thread.id);

const localRow = (group: ThreadGroup): ListRow => ({
  rowId: group.thread.id,
  ...group,
});

function NoFilteredThreads({ filterMenu }: { filterMenu: ReactNode }) {
  return (
    <SidebarGroup>
      {filterMenu}
      <SidebarGroupLabel>Threads</SidebarGroupLabel>
      <p className="px-2 type-caption text-subtle-foreground">
        No open threads match the filter
      </p>
    </SidebarGroup>
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
      startDrag({ kind: 'thread', id: row.thread.id }, row.thread.title, x, y, {
        hasOwnGhost: true,
      });
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
      moveDrag(x, y);
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
      // A mention names this computer's thread to its agent: another computer's isn't one it can read.
      const mentionDrop = isRemoteRow(s.row)
        ? null
        : mentionDropAt(s.state.x, s.state.y);
      const landed = endDrag();
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

/** Whether the dragged row may become a sub-thread of `parentId`; another computer's row never nests, nor nests one. */
function canNestUnder(row: ListRow, parentId: string, threads: Thread[]) {
  return (
    !isRemoteRow(row) &&
    !parseRemoteThreadId(parentId) &&
    parentId !== row.thread.parent?.threadId &&
    parentId !== rootOf(threads, row.thread).id &&
    threads.some((t) => t.id === parentId) &&
    !nestBlocker(threads, row.thread.id, parentId)
  );
}

/**
 * Where the dragged row would go, from the rows as rendered (the placeholder included), so moving the placeholder never flips the
 * answer back. Positions come from `offsetTop` within the (relative) list, not `getBoundingClientRect`: rows gliding to their new
 * place carry a transform that would flip the slot mid-animation. Null when the pointer is off the list.
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
    pinnedIds.filter((id) => id !== row.rowId).length >= PIN_SLOTS.length;
  const canNest = (parentId: string) => canNestUnder(row, parentId, threads);
  const root = isRemoteRow(row) ? row.thread : rootOf(threads, row.thread);
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
 * `isSub`: a sub-thread under its parent, one line unless it asks for you. Another computer's thread shows that computer's icon.
 */
export function ThreadItem({
  thread: listed,
  isSub,
  isActive,
  isSelected,
  isProjectHidden,
  onSelect,
  onRename,
  onSnooze,
}: {
  thread: Thread;
  isSub?: boolean;
  /** Shows the Snooze action beside Settle. GAP: nothing passes it outside the `#thread-rows` mock until snoozing is stored. */
  onSnooze?: (until: Thread['snoozedUntil']) => void;
  /** Listed under its own project already (new thread's Recent): the detail line drops the project icon. */
  isProjectHidden?: boolean;
  isActive: boolean;
  isSelected?: boolean;
  onSelect: (e: ReactMouseEvent) => void;
  onRename?: () => void;
}) {
  const thread = useThread(listed.id) ?? listed;
  const row = useThreadRow(thread);
  const isRenaming = useRenameSurface(thread.id) === 'row';
  const mark = rowStatusMark(row, isActive);
  const asks = row.tone === 'warning' || row.tone === 'destructive';
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {isRenaming ? (
          <RowTitleField thread={thread} />
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]',
              (isActive || row.isUnread) && 'text-foreground',
            )}
          >
            <ThreadTitleText title={thread.title} row={row} />
          </span>
        )}
        {isSub && <PrStack thread={thread} />}
        {!isRenaming && (
          <ActionSlot mark={mark} isSub={isSub} hasSnooze={!!onSnooze} />
        )}
      </span>
      {isSub ? (
        asks && (
          <span
            className={cn(
              'truncate type-meta',
              row.tone === 'destructive' ? 'text-destructive' : 'text-warning',
            )}
          >
            {row.detail}
          </span>
        )
      ) : (
        <RowDetail
          thread={thread}
          row={row}
          isProjectHidden={isProjectHidden}
        />
      )}
    </>
  );
  const button = (
    // Renaming, the row is a div: a field inside a button would click and key through to it.
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
  );
  if (isRenaming) return button;
  return (
    <>
      {button}
      <RowActions thread={thread} onSnooze={onSnooze} />
    </>
  );
}

/** Settle (and Snooze, where offered) in the row's corner while it's hovered or focused. */
function RowActions({
  thread,
  onSnooze,
}: {
  thread: Thread;
  onSnooze?: (until: Thread['snoozedUntil']) => void;
}) {
  const { isSettled, toggle: settle } = useSettle(thread);
  return (
    <>
      <SidebarMenuAction showOnHover asChild className={INLINE_ACTION}>
        <TooltipIconButton
          label={isSettled ? 'Reactivate' : 'Settle'}
          hint={
            isSettled
              ? 'Moves it back to the active list.'
              : 'Stops its agent, terminals and dev servers, and files it under Settled.'
          }
          onClick={settle}
        >
          {isSettled ? <Unarchive /> : <Archive />}
        </TooltipIconButton>
      </SidebarMenuAction>
      {!!onSnooze && (
        <SnoozeAction
          snoozedUntil={thread.snoozedUntil}
          onSnooze={onSnooze}
          className={cn(INLINE_ACTION, 'right-[30px]')}
        />
      )}
    </>
  );
}

const INLINE_ACTION =
  'top-1.5! right-2 size-5 bg-sidebar bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-accent))] [&>svg]:size-3.5';

/**
 * Room for the hover actions at the title line's end, the row's mark in it while they're hidden.
 * A sub-row keeps it at full width so its PR icons never move; elsewhere it widens on hover, truncating the title before the buttons.
 */
function ActionSlot({
  mark,
  isSub,
  hasSnooze,
}: {
  mark: ReturnType<typeof rowStatusMark>;
  isSub?: boolean;
  hasSnooze: boolean;
}) {
  const width = hasSnooze ? 'w-[42px]' : 'w-5';
  const hoverWidth = hasSnooze
    ? 'group-focus-within/menu-item:w-[42px] group-hover/menu-item:w-[42px] group-has-[[aria-expanded=true]]/menu-item:w-[42px]'
    : 'group-focus-within/menu-item:w-5 group-hover/menu-item:w-5';
  return (
    <span
      className={cn('flex shrink-0 justify-end', isSub ? width : hoverWidth)}
    >
      {mark && (
        <StatusMark
          {...mark}
          className="group-focus-within/menu-item:hidden group-hover/menu-item:hidden group-has-[[aria-expanded=true]]/menu-item:hidden"
        />
      )}
    </span>
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
  isProjectHidden,
}: {
  thread: Thread;
  row: ThreadRow;
  isProjectHidden?: boolean;
}) {
  // overflow-visible: the PR discs are 4px taller than the line, and the button truncates its last line.
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-visible! type-meta text-subtle-foreground">
      <ThreadMachineMark threadId={thread.id} />
      {!isProjectHidden && <ThreadProjectMark thread={thread} />}
      <ThreadDetailText row={row} />
      {row.isWatched && (
        <Eye aria-label="Watched" className="size-3 shrink-0" />
      )}
      <PrStack thread={thread} />
      <AgentsBadge thread={thread} />
      <NextRunBadge threadId={thread.id} />
    </span>
  );
}

/** Right-click anywhere in the sidebar, like Arc: edit the current profile in place or add one. */
function SidebarContextMenu({
  space,
  onEdit,
  onAdd,
}: {
  space: Space;
  onEdit: () => void;
  onAdd?: () => void;
}) {
  // The editor and dialog open only once the menu has closed and let go of focus; opened from onSelect, the editor
  // closed again as the menu tore down around it.
  const afterClose = useRef<() => void>(undefined);
  return (
    <ContextMenuContent
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        afterClose.current?.();
        afterClose.current = undefined;
      }}
    >
      <ContextMenuItem onSelect={() => (afterClose.current = onEdit)}>
        <SpaceIcon space={space} />
        Edit {space.name}…
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!onAdd}
        onSelect={() => (afterClose.current = onAdd)}
      >
        <Plus />
        New profile…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => openSubpage('profiles', space.id)}>
        <Settings />
        Profile settings
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function SpaceFooter({
  isEditing,
  onEditingChange,
  onAdd,
}: {
  isEditing: boolean;
  onEditingChange: (isOpen: boolean) => void;
  onAdd?: () => void;
}) {
  const dispatch = useDispatch();
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const space = useSpace();
  const profiles = useProfiles();
  return (
    <SidebarFooter className="relative flex-row items-center gap-1 px-2 py-2">
      {/* Past three profiles the switcher and its + leave the chip too little room for a name. */}
      <UserMenu isCompact={profiles.length > 3} />
      <span className="flex-1" />
      <Popover open={isEditing} onOpenChange={onEditingChange}>
        <PopoverAnchor asChild>
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
                    <BoundShortcut
                      command={spaceCommand(i + 1)}
                      className="ml-1"
                    />
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </PopoverAnchor>
        <PopoverContent side="top" align="end" className="w-auto">
          <SpaceEditor key={space.id} space={space} />
        </PopoverContent>
      </Popover>
      {onAdd && (
        <TooltipIconButton
          label="New profile"
          onClick={onAdd}
          className="size-7 text-subtle-foreground"
        >
          <Plus />
        </TooltipIconButton>
      )}
    </SidebarFooter>
  );
}
