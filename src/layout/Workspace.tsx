import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import type { GroupImperativeHandle } from 'react-resizable-panels';
import type { Thread } from '../model';
import { Edit, Forbidden, Inbox, Route } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { BoardView } from '../BoardView';
import { HANDOFF_TRANSITION, isHandingOff } from '../Composer';
import { NewThreadView } from '../NewThreadView';
import { PANE_TABS, tabTitle } from '../pane/tabs';
import { QueueView } from '../QueueView';
import { useHarness } from '../store';
import { saveLayouts } from '../store/layout';
import { ThreadView } from '../ThreadView';
import { useDragSession } from './drag';
import { useSplitTabDrag } from './useSplitTabDrag';
import { LeafBar } from './SplitControls';
import { PreviewContext, SplitContext } from './SplitContext';
import { displayRoot, equalSizes, findLeaf, leaves, snapSizes, type Leaf, type LayoutNode, type Split, type View, type Zone } from './tree';
import { useLayoutKeys } from './useLayoutKeys';
import { useWatchToasts } from './useWatchToasts';

const WIDE_SPLIT_PX = 760;
const MIN_SPLIT_PX = 240;

/** The current space's tiling layout: nested resizable splits, each a full session with its own header, composer and side pane. */
export function Workspace() {
  const { state } = useHarness();
  const layout = state.layouts[state.spaceId];
  useWindowOrientation();
  useLayoutPersistence();
  useLayoutKeys();
  useWatchToasts();

  const root = displayRoot(layout, state.orientation);
  const all = leaves(root);
  const zoomed = layout.zoomId ? findLeaf(root, layout.zoomId) : undefined;
  const isMulti = all.length > 1;
  useCaretInFocusedSplit(all.map((l) => l.id).join(), layout.focusId, isMulti);

  return (
    <div className={cn('h-full min-h-0', isMulti && 'bg-sidebar p-1.5')}>
      {zoomed ? <LeafView leaf={zoomed} isMulti isZoomed isFirst /> : <NodeView node={root} isMulti={isMulti} firstId={all[0].id} />}
      <DragChip />
    </div>
  );
}

function NodeView({ node, isMulti, firstId }: { node: LayoutNode; isMulti: boolean; firstId: string }) {
  if (node.kind === 'leaf') return <LeafView leaf={node} isMulti={isMulti} isZoomed={false} isFirst={node.id === firstId} />;
  return <SplitView split={node} firstId={firstId} />;
}

function SplitView({ split, firstId }: { split: Split; firstId: string }) {
  const { dispatch } = useHarness();
  const group = useRef<GroupImperativeHandle | null>(null);
  const ids = split.children.map((c) => c.id);
  const toLayout = (sizes: number[]) => Object.fromEntries(ids.map((id, i) => [id, sizes[i]]));
  const equalize = () => {
    group.current?.setLayout(toLayout(equalSizes(ids.length)));
    dispatch({ type: 'layout-equalize', splitId: split.id });
  };

  return (
    <ResizablePanelGroup
      // Remount when the children or direction change: the group keeps its own layout and only reads `defaultLayout` once.
      key={`${split.dir}:${ids.join()}`}
      groupRef={group}
      orientation={split.dir === 'row' ? 'horizontal' : 'vertical'}
      defaultLayout={toLayout(split.sizes)}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return;
        const sizes = snapSizes(ids.map((id) => layout[id]));
        group.current?.setLayout(toLayout(sizes));
        dispatch({ type: 'layout-resize', splitId: split.id, sizes });
      }}
    >
      {split.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <ResizableHandle
              disableDoubleClick
              onDoubleClick={equalize}
              className="w-1.5 rounded-full bg-transparent after:w-2 aria-[orientation=horizontal]:h-1.5 data-[separator=active]:bg-foreground/15 data-[separator=hover]:bg-foreground/10"
            />
          )}
          <ResizablePanel id={child.id} minSize={MIN_SPLIT_PX}>
            <NodeView node={child} isMulti firstId={firstId} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

export function LeafView({ leaf, isMulti, isZoomed, isFirst }: { leaf: Leaf; isMulti: boolean; isZoomed: boolean; isFirst: boolean }) {
  const { state, dispatch } = useHarness();
  const ref = useRef<HTMLElement>(null);
  const isWide = useIsWider(ref, WIDE_SPLIT_PX);
  const isFocused = state.layouts[state.spaceId].focusId === leaf.id;
  useFocusFollows(ref, isFocused && isMulti);
  const focus = () => dispatch({ type: 'layout-focus', leafId: leaf.id });

  return (
    <SplitContext.Provider value={{ leafId: leaf.id, isFocused, isMulti, isZoomed, isFirst, isWide }}>
      <section
        ref={ref}
        data-leaf-id={leaf.id}
        aria-label={isMulti ? `Split${isFocused ? ', focused' : ''}` : undefined}
        tabIndex={-1}
        // Primary button only: right-clicking a split's tab or header opens its menu without focusing the split.
        onPointerDownCapture={(e) => e.button === 0 && focus()}
        onFocusCapture={() => isTabbing() && focus()}
        className={cn('relative h-full min-h-0 min-w-0 bg-background outline-none', isMulti && 'overflow-hidden rounded-xl border border-transparent', isMulti && isFocused && 'border-foreground/20')}
      >
        <LeafContent leafId={leaf.id} view={leaf.view} />
        <DropZone leafId={leaf.id} />
      </section>
    </SplitContext.Provider>
  );
}

function LeafContent({ leafId, view }: { leafId: string; view: View }) {
  const { state } = useHarness();
  if (view.kind === 'tab') return <TabLeaf threadId={view.threadId} tabId={view.tabId} />;
  const thread = view.kind === 'thread' ? state.threads.find((t) => t.id === view.id) : undefined;
  // A thread or tab that no longer exists (deleted, or saved by a launch that showed demo data) opens a new thread.
  const kind = view.kind === 'board' || view.kind === 'queue' ? view.kind : 'new';
  return (
    <>
      {/* Keyed: another thread is a fresh view, so its pane, summary and chat open in their own state instead of animating from the last thread's. */}
      {!!thread && <ThreadView key={thread.id} thread={thread} />}
      {/* Sending from a new thread fades its page out over the thread it started; every other switch is instant. */}
      <AnimatePresence initial={false} custom={isHandingOff(leafId)}>
        {!thread && (
          <PageLeaf key={kind}>
            <LeafBar>
              {kind === 'board' ? <Route className="size-4 text-muted-foreground" /> : kind === 'new' ? <Edit className="size-4 text-muted-foreground" /> : <Inbox className="size-4 text-muted-foreground" />}
              {kind === 'board' ? 'Board' : kind === 'new' ? 'New thread' : 'Queue'}
            </LeafBar>
            <div className="min-h-0 flex-1">{kind === 'board' ? <BoardView /> : kind === 'new' ? <NewThreadView /> : <QueueView />}</div>
          </PageLeaf>
        )}
      </AnimatePresence>
    </>
  );
}

const PAGE_EXIT = { leave: (isHandoff: boolean) => ({ opacity: 0, transition: isHandoff ? HANDOFF_TRANSITION : { duration: 0 } }) };

function PageLeaf({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <motion.div variants={PAGE_EXIT} exit="leave" inert={!isPresent} data-exiting={!isPresent || undefined} className="absolute inset-0 flex min-h-0 flex-col">
      {children}
    </motion.div>
  );
}

/** A side pane tab dragged out into its own split: the tab's content, still owned by its thread's pane. */
function TabLeaf({ threadId, tabId }: { threadId: string; tabId: string }) {
  const { state, dispatch } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  const pane = state.panes.find((p) => p.threadId === threadId);
  const tab = pane?.tabs.find((t) => t.id === tabId);
  const onDragHandle = useSplitTabDrag(threadId, tabId, tab?.kind ?? 'new', tab ? tabTitle(tab) : '');
  if (!thread || !pane || !tab) return <ClosedTab />;
  const { icon: Icon, component: Content } = PANE_TABS[tab.kind];

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <LeafBar>
        <span onPointerDown={onDragHandle} className="app-no-drag flex min-w-0 cursor-grab items-center gap-2 select-none active:cursor-grabbing">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{tabTitle(tab)}</span>
        </span>
        <button type="button" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } })} className="min-w-0 cursor-default truncate font-normal text-subtle-foreground hover:text-foreground">
          {thread.title}
        </button>
      </LeafBar>
      <div className="min-h-0 flex-1">
        <Content thread={thread} pane={pane} tab={tab} />
      </div>
    </div>
  );
}

function ClosedTab() {
  const { dispatch } = useHarness();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <LeafBar>Closed tab</LeafBar>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>This tab was closed</EmptyTitle>
          <EmptyDescription>Its thread closed it, or the thread is gone. Open the Queue here or close the split.</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" onClick={() => dispatch({ type: 'go', view: { kind: 'queue' } })}>
          Open the Queue
        </Button>
      </Empty>
    </div>
  );
}

const ZONE_RECT = {
  left: 'inset-y-1.5 left-1.5 right-1/2',
  right: 'inset-y-1.5 right-1.5 left-1/2',
  top: 'inset-x-1.5 top-1.5 bottom-1/2',
  bottom: 'inset-x-1.5 bottom-1.5 top-1/2',
  center: 'inset-1.5',
} satisfies Record<Zone, string>;

const ZONE_LABEL = { left: 'Open on the left', right: 'Open on the right', top: 'Open above', bottom: 'Open below', center: 'Replace this split' } satisfies Record<Zone, string>;

/** While something is dragged over this split, shows the region it would take, or why it can't open here. */
function DropZone({ leafId }: { leafId: string }) {
  const drag = useDragSession();
  const hit = drag?.hit?.leafId === leafId ? drag.hit : null;
  if (!hit) return null;
  if (drag?.refusal) return <RefusedZone reason={drag.refusal} />;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-50 bg-background/40">
      <div className={cn('absolute flex items-center justify-center rounded-xl border border-foreground/25 bg-foreground/8', ZONE_RECT[hit.zone])}>
        <span className="rounded-full bg-popover px-2.5 py-1 type-caption text-foreground shadow-popover">{ZONE_LABEL[hit.zone]}</span>
      </div>
    </div>
  );
}

function RefusedZone({ reason }: { reason: string }) {
  return (
    <div role="status" className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/40 p-4">
      <span className="flex max-w-72 items-center gap-1.5 rounded-xl bg-popover px-3 py-2 type-caption text-foreground shadow-popover">
        <Forbidden className="size-3.5 shrink-0 text-muted-foreground" />
        {reason}
      </span>
    </div>
  );
}

function DragChip() {
  const drag = useDragSession();
  if (!drag || drag.hasOwnGhost) return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed z-[600] rounded-lg bg-popover px-2.5 py-1 type-meta text-foreground shadow-float" style={{ left: drag.x + 12, top: drag.y + 12 }}>
      {drag.label}
    </div>,
    document.body,
  );
}

/** A thread outside the layout, drawn the way a lone split draws it: Stage Manager's neighbouring pages, so a swipe slides real content in. */
export function ThreadPreview({ thread }: { thread: Thread }) {
  const ref = useRef<HTMLDivElement>(null);
  const isWide = useIsWider(ref, WIDE_SPLIT_PX);
  return (
    <div ref={ref} inert aria-hidden className="size-full min-h-0 min-w-0 bg-background">
      <PreviewContext.Provider value>
        <SplitContext.Provider value={{ leafId: `preview-${thread.id}`, isFocused: false, isMulti: false, isZoomed: false, isFirst: false, isWide }}>
          <ThreadView thread={thread} />
        </SplitContext.Provider>
      </PreviewContext.Provider>
    </div>
  );
}

function useIsWider(ref: RefObject<HTMLElement | null>, px: number) {
  const [isWider, setWider] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWider(el.getBoundingClientRect().width >= px);
    const ro = new ResizeObserver(([e]) => setWider(e.contentRect.width >= px));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, px]);
  return isWider;
}

/** Keyboard focus moves (mod [ ], nav arrows, a preset) also move the caret into the newly focused split's composer. */
function useFocusFollows(ref: RefObject<HTMLElement | null>, isFocused: boolean) {
  const wasFocused = useRef(isFocused);
  useEffect(() => {
    const el = ref.current;
    const becameFocused = isFocused && !wasFocused.current;
    wasFocused.current = isFocused;
    if (!el || !becameFocused || el.contains(document.activeElement)) return;
    (el.querySelector<HTMLElement>('textarea') ?? el).focus({ preventScroll: true });
  }, [ref, isFocused]);
}

let lastTabAt = 0;
if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => e.key === 'Tab' && (lastTabAt = performance.now()), true);

/** Tabbing into a split focuses it; programmatic focus (a composer autofocusing on mount) must not. */
function isTabbing() {
  return performance.now() - lastTabAt < 200;
}

/** After the set of splits changes, composers have autofocused in mount order; put the caret back in the focused split. Parent effects run after children's, so this wins. */
function useCaretInFocusedSplit(structure: string, focusId: string, isMulti: boolean) {
  const latestFocus = useRef(focusId);
  latestFocus.current = focusId;
  useEffect(() => {
    if (!isMulti) return;
    const el = document.querySelector<HTMLElement>(`[data-leaf-id="${latestFocus.current}"]`);
    if (!el || el.contains(document.activeElement)) return;
    (el.querySelector<HTMLElement>('textarea') ?? el).focus({ preventScroll: true });
  }, [structure, isMulti]);
}

function useWindowOrientation() {
  const { dispatch } = useHarness();
  useEffect(() => {
    const onResize = () => dispatch({ type: 'layout-aspect', orientation: window.innerWidth >= window.innerHeight ? 'row' : 'column' });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dispatch]);
}

function useLayoutPersistence() {
  const { state } = useHarness();
  useEffect(() => {
    saveLayouts({ layouts: state.layouts, watched: state.watched, isNeedsYouNear: state.isNeedsYouNear });
  }, [state.layouts, state.watched, state.isNeedsYouNear]);
}
