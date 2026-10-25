import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Reorder } from 'motion/react';
import { useDraggable } from '@dnd-kit/react';
import { Globe, Plus, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { revealIn } from '@/lib/revealIn';
import { cn } from '@/lib/utils';
import {
  isMultiTab,
  type Pane,
  type PaneTab,
  type PaneTabKind,
  type Thread,
} from './model';
import { PANE_TABS, tabTitle } from './pane/tabs';
import { PaneHeader, PaneSlots, PaneTitle } from './pane/PaneHeader';
import {
  CHAT_MIN_W,
  dropTarget,
  GAP,
  resizeColumns,
  resizeRows,
  resolveLayout,
  shareAt,
  type PaneLayout,
  type PaneRect,
  type ResolvedLayout,
} from './pane/layout';
import { isOverPinDrop, setPinned } from './pane/headerPins';
import { NoPanes } from './pane/NoPanes';
import {
  cancelDrag,
  DragSurface,
  endDrag,
  moveDrag,
  startDrag,
  type SurfaceHandlers,
} from './layout/drag';
import { splitTabIds } from './layout/tree';
import { PreviewContext } from './layout/SplitContext';
import { pageKey, usePage } from './browser/pages';
import { useSize } from './browser/PageSurface';
import { useDispatch, useHarnessSelector } from './store';
import { layoutOf, shownTab } from './store/panes';
import { isMod } from './keys';
import { commandOf, isCommand, listenKeydown } from './keymap';
import { TAB_MENU } from './menus/menus';
import { TargetContextMenu } from './menus/TargetContextMenu';

// Long enough for the slowest of them: the 260ms drawer slide of the first pane in or the last one out.
const LAYOUT_ANIMATION_MS = 260;
const DRAG_THRESHOLD = 4;

/**
 * The chat and the thread's panes beside it: each pane kind is its own card with its own header, laid out by
 * `resolveLayout` in columns right of the chat. Without `chat` (a narrow split, the design page) the panes take the width.
 */
export function SidePane({
  thread,
  pane,
  chat,
}: {
  thread: Thread;
  pane: Pane;
  chat?: ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const size = useSize(areaRef);
  const dispatch = useDispatch();
  // A divider drag stays local until release: through the store, every move re-rendered the app and rewrote the saved panes.
  const [draft, setDraft] = useState<ResizePatch>();
  const visible = useVisibleLayout(thread.id, pane);
  const layout = draft ? { ...visible, ...draft } : visible;
  const chatMin = chat ? CHAT_MIN_W : 0;
  // The panes sit GAP below the window's top edge (the layout already leaves GAP at the bottom), so their cards never touch it.
  const paneH = Math.max(0, size.h - GAP);
  const resolved = belowTopGap(resolveLayout(layout, size.w, paneH, chatMin));
  const kinds = layout.columns.flat();
  const isAnimating = useLayoutAnimation(layout, pane.isOpen);
  const leaving = useLeavingPanes(kinds, resolved.rects);
  const entering = useEnteringPanes(kinds);
  const isSliding = entering.isSlide || leaving.some((l) => l.isSlide);
  const [isResizing, setResizing] = useState(false);
  const onResizing = (isOn: boolean) => {
    setResizing(isOn);
    if (isOn || !draft) return;
    dispatch({ type: 'pane-resize', threadId: thread.id, patch: draft });
    setDraft(undefined);
  };
  const move = usePaneMove(thread.id, pane, resolved, areaRef);
  const onKeyDown = usePaneKeys(thread.id, pane, layout);
  useEscapeExpand(thread.id, !!layout.expanded);
  const isEmpty = pane.isOpen && !kinds.length;
  const placeholder = isEmpty
    ? belowTopGap(
        resolveLayout(
          { columns: [['changes']], share: layout.share },
          size.w,
          paneH,
          chatMin,
        ),
      ).rects.changes
    : undefined;
  const chatWidth = !chat
    ? 0
    : placeholder
      ? placeholder.x
      : resolved.chatWidth;
  const showFocus = kinds.length > 1;

  return (
    <DragSurface
      distance={DRAG_THRESHOLD}
      canStart={isPaneGrab}
      {...move.handlers}
    >
      <div
        ref={areaRef}
        onKeyDown={onKeyDown}
        data-motion={isSliding ? 'slide' : undefined}
        className={cn(
          'relative h-full min-h-0 overflow-hidden',
          isAnimating && !isResizing && 'pane-layout-animating',
        )}
      >
        {!!chat && (
          <div
            className="pane-chat absolute inset-y-0 left-0 min-w-0"
            style={{ width: size.w ? chatWidth : '100%' }}
          >
            {chat}
          </div>
        )}
        {size.w > 0 &&
          kinds.map((kind) => (
            <PaneCard
              key={kind}
              thread={thread}
              pane={pane}
              kind={kind}
              rect={resolved.rects[kind]!}
              isFocused={layout.focused === kind}
              showFocus={showFocus}
              isExpanded={layout.expanded === kind}
              isMoving={move.kind === kind}
              entering={
                entering.kinds.includes(kind)
                  ? entering.isSlide
                    ? 'slide'
                    : 'fade'
                  : undefined
              }
            />
          ))}
        {leaving.map(({ kind, rect, isSlide }) => (
          <LeavingPane
            key={`leaving:${kind}`}
            kind={kind}
            rect={rect}
            isSlide={isSlide}
          />
        ))}
        {!!placeholder && <EmptyPanes thread={thread} rect={placeholder} />}
        {!layout.expanded && (
          <Dividers
            threadId={thread.id}
            layout={layout}
            resolved={resolved}
            width={size.w}
            hasChat={!!chat}
            onPreview={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onResizing={onResizing}
          />
        )}
        {!!move.indicator && (
          <span
            aria-hidden
            className="pointer-events-none absolute z-30 rounded-full bg-foreground/50"
            style={move.indicator}
          />
        )}
      </div>
    </DragSurface>
  );
}

/** The layout moved down by GAP, so cards, dividers and drop targets share one frame; never a wrapper over the chat to do it. */
function belowTopGap(resolved: ResolvedLayout): ResolvedLayout {
  const rects = Object.fromEntries(
    Object.entries(resolved.rects).map(([kind, r]) => [
      kind,
      r && { ...r, y: r.y + GAP },
    ]),
  ) as ResolvedLayout['rects'];
  return { ...resolved, rects };
}

/** Tabs dragged out into their own split live there, not in a pane, until they're dropped back or their split closes. */
export function useSplitTabIds(threadId: string) {
  const layouts = useHarnessSelector((s) => s.layouts);
  return splitTabIds(Object.values(layouts), threadId);
}

/** The stored layout minus panes with nothing to show here (popped out, moved to a split), and nothing while the pane is hidden. */
function useVisibleLayout(threadId: string, pane: Pane): PaneLayout {
  const inSplits = useSplitTabIds(threadId);
  const layout = layoutOf(pane);
  if (!pane.isOpen) return { ...layout, columns: [] };
  const isShowable = (kind: PaneTabKind) =>
    pane.tabs.some(
      (t) => t.kind === kind && !t.isPopped && !inSplits.has(t.id),
    );
  const columns = layout.columns
    .map((c) => c.filter(isShowable))
    .filter((c) => c.length);
  return {
    ...layout,
    columns,
    expanded:
      layout.expanded && isShowable(layout.expanded)
        ? layout.expanded
        : undefined,
  };
}

/** Panes slide to their new place when one opens, closes, moves or expands; never while a window resize or a divider drag moves them. */
function useLayoutAnimation(layout: PaneLayout, isOpen: boolean) {
  const shape = JSON.stringify([isOpen, layout.columns, layout.expanded]);
  const [last, setLast] = useState(shape);
  // The shape being animated to: a change mid-animation restarts the timer.
  const [animating, setAnimating] = useState<string | null>(null);
  if (shape !== last) {
    setLast(shape);
    setAnimating(shape);
  }
  useEffect(() => {
    if (animating === null) return;
    const t = window.setTimeout(() => setAnimating(null), LAYOUT_ANIMATION_MS);
    return () => window.clearTimeout(t);
  }, [animating]);
  return animating !== null;
}

/**
 * Panes opened since the last render animate in: the first one in an empty column slides in from the right edge like the sidebar,
 * one added beside others scales in. What was there when the panes mounted (a thread opened, a swipe landed) never animates.
 */
function useEnteringPanes(kinds: PaneTabKind[]) {
  const last = useRef(kinds);
  const [entering, setEntering] = useState<{
    kinds: PaneTabKind[];
    isSlide: boolean;
  }>({ kinds: [], isSlide: false });
  useLayoutEffect(() => {
    const added = kinds.filter((k) => !last.current.includes(k));
    const wasEmpty = last.current.length === 0;
    last.current = kinds;
    if (!added.length) return;
    setEntering((e) => ({
      kinds: [...new Set([...e.kinds, ...added])],
      isSlide: wasEmpty || e.isSlide,
    }));
    window.setTimeout(
      () =>
        setEntering((e) => ({
          kinds: e.kinds.filter((k) => !added.includes(k)),
          isSlide: false,
        })),
      LAYOUT_ANIMATION_MS,
    );
  });
  return entering;
}

/** A closing pane's card: its header so it doesn't read as a blank box, then the exit (a slide out when it was the last one). */
function LeavingPane({
  kind,
  rect,
  isSlide,
}: {
  kind: PaneTabKind;
  rect: PaneRect;
  isSlide: boolean;
}) {
  const { title, icon: Icon } = PANE_TABS[kind];
  return (
    <div
      aria-hidden
      data-motion={isSlide ? 'slide' : 'fade'}
      className="pane-card pane-card-leaving pointer-events-none absolute flex flex-col overflow-hidden rounded-lg border border-border bg-card"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        data-pane-header
        className="flex h-9 shrink-0 items-center gap-1.5 pl-3"
      >
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate type-meta font-medium">{title}</span>
      </div>
    </div>
  );
}

/**
 * A pane that closes leaves its card behind for one exit animation while the others slide into its room; the pane's own content
 * is already gone (its tab left the state), so what fades is the empty card. A layout effect, so no frame shows the gap first.
 */
function useLeavingPanes(kinds: PaneTabKind[], rects: ResolvedLayout['rects']) {
  const last = useRef({ kinds, rects });
  const [leaving, setLeaving] = useState<
    { kind: PaneTabKind; rect: PaneRect; isSlide: boolean }[]
  >([]);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { kinds, rects };
    const gone = before.kinds.filter(
      (k) =>
        !kinds.includes(k) && before.rects[k] && !before.rects[k]!.isHidden,
    );
    if (!gone.length) return;
    // The last pane out (or the whole column hidden) slides off like the sidebar; one of several just fades.
    const isSlide = kinds.length === 0;
    setLeaving((l) => [
      ...l.filter((x) => !gone.includes(x.kind)),
      ...gone.map((kind) => ({ kind, rect: before.rects[kind]!, isSlide })),
    ]);
    window.setTimeout(
      () => setLeaving((l) => l.filter((x) => !gone.includes(x.kind))),
      LAYOUT_ANIMATION_MS,
    );
  });
  return leaving.filter((x) => !kinds.includes(x.kind));
}

function PaneCard({
  thread,
  pane,
  kind,
  rect,
  isFocused,
  showFocus,
  isExpanded,
  isMoving,
  entering,
}: {
  thread: Thread;
  pane: Pane;
  kind: PaneTabKind;
  rect: PaneRect;
  isFocused: boolean;
  showFocus: boolean;
  isExpanded: boolean;
  isMoving: boolean;
  entering: 'slide' | 'fade' | undefined;
}) {
  const dispatch = useDispatch();
  const { ref, handleRef } = useDraggable({ id: kind });
  const tab = shownTab(pane, kind);
  const Content = PANE_TABS[kind].component;
  const focus = () =>
    !isFocused &&
    dispatch({ type: 'pane-focus-kind', threadId: thread.id, kind });

  return (
    <section
      ref={ref}
      aria-label={PANE_TABS[kind].title}
      data-pane={kind}
      data-panes-of={thread.id}
      data-side-pane
      data-motion={entering}
      tabIndex={-1}
      hidden={rect.isHidden}
      onPointerDownCapture={focus}
      onFocusCapture={focus}
      // Expanded, the card drops its chrome and sits flush with the thread area's edges instead of the layout's inset rect.
      style={
        isExpanded
          ? { left: 0, top: 0, width: '100%', height: '100%' }
          : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
      }
      className={cn(
        'pane-card absolute flex flex-col overflow-hidden bg-card outline-none',
        !!entering && 'pane-card-entering',
        isExpanded
          ? 'z-20'
          : cn(
              'rounded-lg border',
              showFocus && isFocused ? 'border-foreground/20' : 'border-border',
            ),
        isMoving && 'opacity-60',
      )}
    >
      <PaneSlots>
        <PaneHeader
          kind={kind}
          threadId={thread.id}
          tabId={tab?.id}
          isExpanded={isExpanded}
          onExpand={() =>
            dispatch({
              type: 'pane-expand',
              threadId: thread.id,
              kind: isExpanded ? undefined : kind,
            })
          }
          onClose={() =>
            dispatch({ type: 'pane-close-kind', threadId: thread.id, kind })
          }
          dragHandle={handleRef}
        />
        {isMultiTab(kind) && (
          <PaneTabs thread={thread} pane={pane} kind={kind} shown={tab} />
        )}
        <div className={cn('min-h-0 flex-1', rect.isCollapsed && 'hidden')}>
          {!!tab && <Content thread={thread} pane={pane} tab={tab} />}
        </div>
      </PaneSlots>
    </section>
  );
}

/** A multi-tab pane's own tabs in its header, plus New tab where a blank one makes sense. */
function PaneTabs({
  thread,
  pane,
  kind,
  shown,
}: {
  thread: Thread;
  pane: Pane;
  kind: PaneTabKind;
  shown?: PaneTab;
}) {
  const dispatch = useDispatch();
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = pane.tabs.filter((t) => t.kind === kind && !t.isPopped);
  const order = tabs.map((t) => t.id);
  const shownId = shown?.id;
  useEffect(() => {
    const list = listRef.current;
    const el =
      shownId !== undefined && list?.querySelector('[aria-selected=true]');
    if (list && el) revealIn(list, el);
  }, [shownId]);
  const reorder = (next: string[]) =>
    dispatch({ type: 'pane-reorder', threadId: thread.id, order: next });
  const step = (id: string, by: 1 | -1) => {
    const from = order.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    reorder(next);
  };
  return (
    <PaneTitle>
      <Reorder.Group
        ref={listRef}
        as="div"
        axis="x"
        values={order}
        onReorder={reorder}
        role="tablist"
        aria-label={`${PANE_TABS[kind].title} tabs`}
        className="-ml-1.5 flex min-w-0 items-center gap-0.5 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab) => (
          <TargetContextMenu
            key={tab.id}
            target={{ threadId: thread.id, tabId: tab.id }}
            groups={TAB_MENU}
          >
            <Reorder.Item
              as="div"
              value={tab.id}
              // Tabs land in place when opened, closed or reordered: no layout animation, only the drag itself follows the pointer.
              transition={{ duration: 0 }}
              className={cn(
                'group/tab relative flex h-7 min-w-14 flex-[0_1_10rem] items-center rounded-md',
                tab.id === shown?.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === shown?.id}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                onClick={() =>
                  dispatch({
                    type: 'pane-select-tab',
                    threadId: thread.id,
                    tabId: tab.id,
                  })
                }
                onKeyDown={(e) => {
                  if (
                    !e.altKey ||
                    (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
                  )
                    return;
                  e.preventDefault();
                  step(tab.id, e.key === 'ArrowLeft' ? -1 : 1);
                }}
                className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 pr-0.5 pl-2 type-meta"
              >
                {tab.kind === 'browser' && (
                  <TabFavicon threadId={thread.id} tab={tab} />
                )}
                <span className="truncate">{tabTitle(tab)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${tabTitle(tab)}`}
                onClick={() =>
                  dispatch({
                    type: 'pane-close-tab',
                    threadId: thread.id,
                    tabId: tab.id,
                  })
                }
                className={cn(
                  'mr-0.5 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100',
                  tab.id === shown?.id && 'opacity-100',
                )}
              >
                <X />
              </Button>
            </Reorder.Item>
          </TargetContextMenu>
        ))}
      </Reorder.Group>
      {kind !== 'visual' && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New tab"
          className="shrink-0 text-muted-foreground"
          onClick={() =>
            dispatch({ type: 'pane-open-tab', threadId: thread.id, kind })
          }
        >
          <Plus />
        </Button>
      )}
    </PaneTitle>
  );
}

/** A browser tab's page icon, or a globe while the page names none or it fails to load. */
function TabFavicon({ threadId, tab }: { threadId: string; tab: PaneTab }) {
  const { favicon } = usePage(pageKey(threadId, tab.id), tab.url ?? '');
  const [broken, setBroken] = useState<string | null>(null);
  if (!favicon || favicon === broken)
    return <Globe aria-hidden className="size-3.5 shrink-0" />;
  return (
    <img
      src={favicon}
      alt=""
      aria-hidden
      onError={() => setBroken(favicon)}
      className="size-3.5 shrink-0 rounded-xs object-contain"
    />
  );
}

function EmptyPanes({ thread, rect }: { thread: Thread; rect: PaneRect }) {
  return (
    <section
      aria-label="Panes"
      data-panes-of={thread.id}
      data-side-pane
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      className="pane-card absolute overflow-hidden rounded-lg border bg-card"
    >
      <NoPanes thread={thread} />
    </section>
  );
}

type ResizePatch = Pick<PaneLayout, 'weights' | 'share' | 'columnWeights'>;

/**
 * Invisible until hovered: chat | columns, between columns, and between two open panes of a column. Each drag previews the
 * layout's share or weights, committed by `onResizing(false)`; double-click resets them.
 */
function Dividers({
  threadId,
  layout,
  resolved,
  width,
  hasChat,
  onPreview,
  onResizing,
}: {
  threadId: string;
  layout: PaneLayout;
  resolved: ResolvedLayout;
  width: number;
  hasChat: boolean;
  onPreview: (patch: ResizePatch) => void;
  onResizing: (isResizing: boolean) => void;
}) {
  const dispatch = useDispatch();
  const reset = (patch: ResizePatch) =>
    dispatch({ type: 'pane-resize', threadId, patch });
  const { columns, rects } = resolved;
  if (!columns.length) return null;
  const rows = columns.flatMap((c) =>
    c.kinds.slice(1).flatMap((lower, i) => {
      const upper = c.kinds[i];
      const u = rects[upper]!;
      const l = rects[lower]!;
      return u.isCollapsed || l.isCollapsed
        ? []
        : [
            {
              key: `${upper}/${lower}`,
              upper: { kind: upper, h: u.h },
              lower: { kind: lower, h: l.h },
              x: c.x,
              w: c.w,
              y: u.y + u.h,
              top: u.y,
            },
          ];
    }),
  );
  return (
    <>
      {hasChat && (
        <Divider
          axis="x"
          style={{ left: columns[0].x - GAP, top: 0, bottom: 0, width: GAP }}
          label="Resize the panes"
          onResizing={onResizing}
          onMove={(x) => onPreview({ share: shareAt(width, x + GAP / 2) })}
          onReset={() => reset({ share: undefined })}
        />
      )}
      {columns.slice(1).map((c, i) => (
        <Divider
          key={c.kinds[0]}
          axis="x"
          style={{ left: c.x - GAP, top: 0, bottom: 0, width: GAP }}
          label="Resize the columns"
          onResizing={onResizing}
          onMove={(x) =>
            onPreview(resizeColumns(layout, columns, i, x - columns[i].x))
          }
          onReset={() => reset({ columnWeights: undefined })}
        />
      ))}
      {rows.map((r) => (
        <Divider
          key={r.key}
          axis="y"
          style={{ left: r.x, width: r.w, top: r.y, height: GAP }}
          label="Resize the panes"
          onResizing={onResizing}
          onMove={(_, y) =>
            onPreview(resizeRows(layout, r.upper, r.lower, y - r.top))
          }
          onReset={() =>
            reset({
              weights: {
                ...layout.weights,
                [r.upper.kind]: 1,
                [r.lower.kind]: 1,
              },
            })
          }
        />
      ))}
    </>
  );
}

/** One divider; `onMove` gets the pointer in the pane area's coordinates. */
function Divider({
  axis,
  style,
  label,
  onMove,
  onReset,
  onResizing,
}: {
  axis: 'x' | 'y';
  style: React.CSSProperties;
  label: string;
  onMove: (x: number, y: number) => void;
  onReset: () => void;
  onResizing: (isResizing: boolean) => void;
}) {
  const origin = useRef<DOMRect | null>(null);
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = e.currentTarget.parentElement!.getBoundingClientRect();
        onResizing(true);
      }}
      onPointerMove={(e) =>
        origin.current &&
        onMove(e.clientX - origin.current.x, e.clientY - origin.current.y)
      }
      onPointerUp={() => {
        origin.current = null;
        onResizing(false);
      }}
      onDoubleClick={onReset}
      style={style}
      className={cn(
        'group/divider absolute z-10 flex items-center justify-center',
        axis === 'x' ? 'cursor-col-resize' : 'cursor-row-resize',
      )}
    >
      <span
        className={cn(
          'rounded-full bg-border opacity-0 transition-opacity group-hover/divider:opacity-100 group-active/divider:opacity-100',
          axis === 'x' ? 'h-8 w-0.5' : 'h-0.5 w-8',
        )}
      />
    </div>
  );
}

/**
 * Dragging a pane by its header: over the columns it moves there (a line shows where), over a split it opens there like a
 * dragged tab did, over the thread header it pins its kind. Esc cancels.
 */
function usePaneMove(
  threadId: string,
  pane: Pane,
  resolved: ResolvedLayout,
  areaRef: RefObject<HTMLDivElement | null>,
) {
  const dispatch = useDispatch();
  const [kind, setKind] = useState<PaneTabKind>();
  const [target, setTarget] = useState<{
    col: number;
    row: number;
    line: React.CSSProperties;
  }>();
  const targetAt = ({ x, y }: { x: number; y: number }) => {
    const area = areaRef.current?.getBoundingClientRect();
    return area ? dropTarget(resolved, x - area.x, y - area.y) : undefined;
  };

  const handlers: SurfaceHandlers = {
    onDragStart: ({ operation }) => {
      const dragged = operation.source!.id as PaneTabKind;
      const tab = shownTab(pane, dragged);
      const { x, y } = operation.position.current;
      setKind(dragged);
      if (tab)
        startDrag(
          { kind: 'tab', threadId, tabId: tab.id },
          PANE_TABS[dragged].title,
          x,
          y,
        );
    },
    onDragMove: ({ operation }) => {
      const at = operation.position.current;
      moveDrag(at.x, at.y);
      setTarget(targetAt(at));
    },
    onDragEnd: ({ operation, canceled }) => {
      const dragged = operation.source!.id as PaneTabKind;
      const at = operation.position.current;
      setKind(undefined);
      setTarget(undefined);
      if (canceled) return cancelDrag();
      const landed = endDrag();
      const current = targetAt(at);
      if (current)
        return dispatch({
          type: 'pane-move-kind',
          threadId,
          kind: dragged,
          col: current.col,
          row: current.row,
        });
      if (isOverPinDrop(at.x, at.y)) return setPinned(dragged, true);
      if (landed) dispatch({ type: 'layout-drop', ...landed });
    },
  };

  return { kind, handlers, indicator: target?.line };
}

/** Presses on the header's own controls and tabs click them; anywhere else on it drags the pane. */
const isPaneGrab = (target: Element) =>
  !target.closest('button, a, input, select, [role=tab], [role=combobox]');

/** Next / previous pane and Close tab are commands (`src/keymap.ts`); mod 1–9 picks a tab of a multi-tab pane and stays fixed. */
function usePaneKeys(threadId: string, pane: Pane, layout: PaneLayout) {
  const dispatch = useDispatch();
  return (e: KeyboardEvent) => {
    const kinds = layout.columns.flat();
    const focused =
      layout.focused && kinds.includes(layout.focused)
        ? layout.focused
        : kinds[0];
    if (!focused) return;
    const tabs = pane.tabs.filter((t) => t.kind === focused && !t.isPopped);
    const shown = shownTab(pane, focused);
    const command = commandOf(e, ['pane-next', 'pane-previous', 'tab-close']);
    if (command === 'pane-next' || command === 'pane-previous') {
      const next = kinds.at(
        (kinds.indexOf(focused) + (command === 'pane-previous' ? -1 : 1)) %
          kinds.length,
      )!;
      dispatch({ type: 'pane-focus-kind', threadId, kind: next });
      e.currentTarget
        .querySelector<HTMLElement>(`[data-pane="${next}"]`)
        ?.focus();
    } else if (isMod(e) && /^[1-9]$/.test(e.key) && isMultiTab(focused)) {
      const tab = e.key === '9' ? tabs.at(-1) : tabs[Number(e.key) - 1];
      if (tab) dispatch({ type: 'pane-select-tab', threadId, tabId: tab.id });
    } else if (command === 'tab-close') {
      if (isMultiTab(focused) && shown)
        dispatch({ type: 'pane-close-tab', threadId, tabId: shown.id });
      else dispatch({ type: 'pane-close-kind', threadId, kind: focused });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
}

/** Esc anywhere leaves full size, unless something with its own Esc has focus (a terminal, a field, a menu). Previews never listen. */
function useEscapeExpand(threadId: string, isExpanded: boolean) {
  const dispatch = useDispatch();
  const isPreview = useContext(PreviewContext);
  useEffect(() => {
    if (!isExpanded || isPreview) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isCommand(e, 'dismiss') || e.defaultPrevented) return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          '.xterm, input, textarea, [contenteditable], [role=dialog], [role=menu], [role=listbox]',
        )
      )
        return;
      e.preventDefault();
      dispatch({ type: 'pane-expand', threadId, kind: undefined });
    };
    return listenKeydown(onKey);
  }, [dispatch, threadId, isExpanded, isPreview]);
}
