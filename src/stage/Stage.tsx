import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useMotionValue, useReducedMotionConfig, useScroll, useTransform, type MotionValue } from 'motion/react';
import { cn } from '@/lib/utils';
import { endDrag, moveDrag, startDrag } from '../layout/drag';
import { findLeaf, leaves, type Side } from '../layout/tree';
import { ThreadPreview, Workspace } from '../layout/Workspace';
import { pinnedThreads } from '../reorder';
import { useHarness, useThread, type State } from '../store';
import { CENTER, cardPose, needsYouNearCenter, stackCount, stageSlots, type StageSlots } from './carousel';
import { Overview } from './Overview';
import { SnapshotCard, type StripSide } from './SnapshotCard';
import { useThreadSnapshots, type ThreadSnapshot } from './snapshot';
import { useStageKeys } from './useStageKeys';
import { useSnapPager } from '../useSnapPager';
import { useWindowSyncHost } from './windowSync';
import { THREAD_MENU } from '../menus/menus';
import { TargetContextMenu } from '../menus/TargetContextMenu';

const CARD = { landscape: { w: 248, h: 176 }, portrait: { w: 248, h: 150 } };
const DRAG_SLOP_PX = 6;

/**
 * The main area. Normally the split workspace; in Stage Manager mode the workspace (one session or a split group) sits centered at 88%
 * and the other pinned threads stick out of the edges as 3D cards. The scroller is a native one with one snap page per pinned thread
 * (`snap-always`, so a gesture stops at the next one): the browser owns tracking and momentum, Motion only reads the offset to move the
 * center 1:1 and pose the cards.
 */
export function Stage() {
  const { state, dispatch } = useHarness();
  useWindowSyncHost();
  const reduce = !!useReducedMotionConfig();
  const isStage = state.isStage;
  const isPortrait = state.orientation === 'column';
  const axis = isPortrait ? 'y' : 'x';
  const slots = useStageSlots(state);
  const scroller = useRef<HTMLDivElement>(null);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const size = isPortrait ? height : width;
  const { scrollX, scrollY } = useScroll({ container: scroller });
  const pos = useTransform([isPortrait ? scrollY : scrollX, size], ([offset, page]: number[]) => (isStage && page ? offset / page : slots.center));
  const open = (id: string | undefined) => {
    if (id && id !== CENTER) dispatch({ type: 'go', view: { kind: 'thread', id } });
  };
  useSnapPager(scroller, { axis, index: isStage ? slots.center : 0, onSettle: (page) => isStage && open(slots.ids[page]) });
  useStageKeys((step) => open(slots.ids[slots.center + step]));

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      width.set(el.clientWidth);
      height.set(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const scrollToSlot = (i: number) => scroller.current?.scrollTo({ [isPortrait ? 'top' : 'left']: i * size.get(), behavior: reduce ? 'instant' : 'smooth' });
  const pages = isStage ? slots.ids.length : 1;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div
        ref={scroller}
        data-stage={isStage || undefined}
        // Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility.
        style={isStage ? { scrollbarWidth: 'none' } : undefined}
        className={cn('h-full', isStage ? cn('overscroll-contain bg-sidebar', isPortrait ? 'snap-y snap-mandatory overflow-x-hidden overflow-y-auto' : 'snap-x snap-mandatory overflow-x-auto overflow-y-hidden') : 'overflow-hidden')}
      >
        <div className="relative h-full w-full" style={isPortrait ? { height: `${pages * 100}%` } : { width: `${pages * 100}%` }}>
          {isStage && slots.ids.map((_, i) => <SnapPoint key={i} slot={i} pages={pages} isPortrait={isPortrait} />)}
          {isStage && (
            <div className="pointer-events-none sticky top-0 left-0 h-full w-full" style={isPortrait ? { height: `${100 / pages}%` } : { width: `${100 / pages}%` }}>
              <EdgeCards slots={slots} pos={pos} size={size} isPortrait={isPortrait} isFlat={reduce} onOpen={scrollToSlot} />
            </div>
          )}
          <Page slot={isStage ? slots.center : 0} pages={pages} isPortrait={isPortrait}>
            <CenterFrame isStage={isStage} isPortrait={isPortrait} />
          </Page>
          {isStage &&
            slots.ids.map(
              (id, i) =>
                i !== slots.center && (
                  <Page key={`${id}:${i}`} slot={i} pages={pages} isPortrait={isPortrait}>
                    {Math.abs(i - slots.center) === 1 && id !== CENTER && <NeighborFrame id={id} isPortrait={isPortrait} />}
                  </Page>
                ),
            )}
        </div>
      </div>
      {state.isOverview && <Overview />}
    </div>
  );
}

/**
 * The snap target of one slot, keyed by slot so it never unmounts when a swipe commits. Chromium re-snaps when the element it snapped to
 * leaves the DOM: with the content pages as targets, landing on the previous session removed its neighbour page and the scroller jumped
 * back to the old one, undoing the swipe.
 */
function SnapPoint({ slot, pages, isPortrait }: { slot: number; pages: number; isPortrait: boolean }) {
  return <div aria-hidden className="pointer-events-none absolute snap-start snap-always" style={slotStyle(slot, pages, isPortrait)} />;
}

/**
 * One session's page of the scroll content. Every session sits in its own page and the browser scrolls them natively (on the compositor, no frame of lag);
 * committing a swipe only moves the live workspace's page to the slot you landed on, a style change rather than a remount.
 */
function Page({ slot, pages, isPortrait, children }: { slot: number; pages: number; isPortrait: boolean; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute flex items-center justify-center" style={slotStyle(slot, pages, isPortrait)}>
      {children}
    </div>
  );
}

function slotStyle(slot: number, pages: number, isPortrait: boolean): CSSProperties {
  const at = `${(slot * 100) / pages}%`;
  const span = `${100 / pages}%`;
  return isPortrait ? { top: at, height: span, left: 0, right: 0 } : { left: at, width: span, top: 0, bottom: 0 };
}

/** The workspace. Always the same element so toggling the stage never remounts the sessions in it. */
function CenterFrame({ isStage, isPortrait }: { isStage: boolean; isPortrait: boolean }) {
  return (
    <div className={cn('pointer-events-auto min-h-0 min-w-0', isStage ? frameClass(isPortrait) : 'size-full')}>
      <Workspace />
    </div>
  );
}

/** The pinned thread on either side of the center, rendered for real (read-only), so a swipe slides its content in instead of a blank. */
function NeighborFrame({ id, isPortrait }: { id: string; isPortrait: boolean }) {
  const thread = useThread(id);
  if (!thread) return null;
  return (
    <div className={frameClass(isPortrait)}>
      <ThreadPreview thread={thread} />
    </div>
  );
}

const frameClass = (isPortrait: boolean) => cn('isolate overflow-hidden rounded-xl border border-border bg-background', isPortrait ? 'h-[88%] w-[calc(100%-24px)]' : 'h-[calc(100%-24px)] w-[88%]');

function EdgeCards({ slots, pos, size, isPortrait, isFlat, onOpen }: { slots: StageSlots; pos: MotionValue<number>; size: MotionValue<number>; isPortrait: boolean; isFlat: boolean; onOpen: (i: number) => void }) {
  const snaps = useThreadSnapshots(slots.ids.filter((id) => id !== CENTER));
  const byId = new Map(snaps.map((s) => [s.id, s]));
  return (
    <div aria-label="Pinned threads" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ perspective: 900 }}>
      {slots.ids.map((id, i) => {
        const snap = byId.get(id);
        if (!snap || i === slots.center) return null;
        const side: Side = isPortrait ? (i < slots.center ? 'top' : 'bottom') : i < slots.center ? 'left' : 'right';
        return <EdgeCard key={id} snap={snap} i={i} side={side} stacked={stackCount(i, slots)} pos={pos} size={size} isPortrait={isPortrait} isFlat={isFlat} onOpen={() => onOpen(i)} />;
      })}
    </div>
  );
}

const STRIP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } satisfies Record<Side, StripSide>;
const ORIGIN = { left: 'origin-right', right: 'origin-left', top: 'origin-bottom', bottom: 'origin-top' } satisfies Record<Side, string>;
// Hover or keyboard focus slides the card out of its edge and turns it most of the way toward the viewer: the peek.
const PEEK = {
  left: 'group-hover:translate-x-[210px] group-hover:-rotate-y-[26deg] group-focus-visible:translate-x-[210px] group-focus-visible:-rotate-y-[26deg]',
  right: 'group-hover:-translate-x-[210px] group-hover:rotate-y-[26deg] group-focus-visible:-translate-x-[210px] group-focus-visible:rotate-y-[26deg]',
  top: 'group-hover:translate-y-[130px] group-hover:rotate-x-[26deg] group-focus-visible:translate-y-[130px] group-focus-visible:rotate-x-[26deg]',
  bottom: 'group-hover:-translate-y-[130px] group-hover:-rotate-x-[26deg] group-focus-visible:-translate-y-[130px] group-focus-visible:-rotate-x-[26deg]',
} satisfies Record<Side, string>;

function EdgeCard({ snap, i, side, stacked, pos, size, isPortrait, isFlat, onOpen }: { snap: ThreadSnapshot; i: number; side: Side; stacked: number | null; pos: MotionValue<number>; size: MotionValue<number>; isPortrait: boolean; isFlat: boolean; onOpen: () => void }) {
  const card = isPortrait ? CARD.portrait : CARD.landscape;
  const transform = useTransform([pos, size], ([p, extent]: number[]) => cardTransform(i - p, extent, isPortrait, isFlat));
  const opacity = useTransform(pos, (p) => cardPose(i - p, isFlat).opacity);
  const zIndex = useTransform(pos, (p) => cardPose(i - p, isFlat).z);
  const pointerEvents = useTransform(opacity, (o) => (o > 0.5 ? 'auto' : 'none'));
  const transformOrigin = useTransform(pos, (p) => (isPortrait ? (i < p ? '50% 100%' : '50% 0%') : i < p ? '100% 50%' : '0% 50%'));
  const drag = useCardDrag(snap, side, onOpen);
  const base: CSSProperties = isPortrait ? { top: 0, left: `calc(50% - ${card.w / 2}px)` } : { left: 0, top: `calc(50% - ${card.h / 2}px)` };

  return (
    <motion.div className="absolute" style={{ ...base, width: card.w, height: card.h, transform, opacity, zIndex, pointerEvents, transformOrigin, transformStyle: 'preserve-3d' }}>
      <TargetContextMenu target={{ threadId: snap.id }} groups={THREAD_MENU}>
        <button type="button" aria-label={`Open ${snap.title}`} {...drag} className="group size-full cursor-default touch-none rounded-xl outline-none select-none [transform-style:preserve-3d]">
          <div className={cn('size-full transition-[translate,transform] duration-240 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:duration-160 motion-reduce:transition-none', ORIGIN[side], !isFlat && PEEK[side], isFlat && PEEK[side].replace(/\S*rotate\S*/g, ''))}>
            <SnapshotCard snap={snap} strip={STRIP[side]} stacked={stacked} className="size-full group-focus-visible:ring-2 group-focus-visible:ring-ring" />
          </div>
        </button>
      </TargetContextMenu>
    </motion.div>
  );
}

/** `extent` is the stage's length along the scroll axis: cards after the center hang off its far edge. */
function cardTransform(d: number, extent: number, isPortrait: boolean, isFlat: boolean) {
  const p = cardPose(d, isFlat);
  const isBefore = d < 0;
  if (isPortrait) {
    const y = isBefore ? p.inset - CARD.portrait.h : extent - p.inset;
    return `translate3d(${p.fan}px, ${y}px, ${p.depth}px) rotateX(${isBefore ? -p.rotate : p.rotate}deg) scale(${p.scale})`;
  }
  const x = isBefore ? p.inset - CARD.landscape.w : extent - p.inset;
  return `translate3d(${x}px, ${p.fan}px, ${p.depth}px) rotateY(${isBefore ? p.rotate : -p.rotate}deg) scale(${p.scale})`;
}

/** Click opens the card; dragging it past a few px lifts it into the shared drag session, and dropping on a split opens it beside that split. */
function useCardDrag(snap: ThreadSnapshot, side: Side, onOpen: () => void) {
  const { dispatch } = useHarness();
  const start = useRef<{ x: number; y: number; isDragging: boolean } | null>(null);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, y: e.clientY, isDragging: false };
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (s.isDragging) return moveDrag(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_SLOP_PX) return;
      s.isDragging = true;
      startDrag({ kind: 'thread', id: snap.id }, snap.title, e.clientX, e.clientY, { centerAs: side });
    },
    onPointerUp: () => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      if (!s.isDragging) return onOpen();
      const landed = endDrag();
      if (landed) dispatch({ type: 'layout-drop', leafId: landed.leafId, zone: landed.zone, view: landed.view });
    },
    onPointerCancel: () => {
      if (start.current?.isDragging) endDrag();
      start.current = null;
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    },
  };
}

function useStageSlots(state: State) {
  const layout = state.layouts[state.spaceId];
  const onStage = leaves(layout.root).flatMap((l) => (l.view.kind === 'thread' ? [l.view.id] : []));
  const pinned = pinnedThreads(state.threads, state.spaceId).map((t) => t.id);
  const slots = stageSlots(pinned, onStage, focusedThreadId(state));
  if (!state.isNeedsYouNear) return slots;
  const needsYou = new Set(state.threads.filter((t) => t.status === 'needs-you').map((t) => t.id));
  return needsYouNearCenter(slots, (id) => needsYou.has(id));
}

function focusedThreadId(state: State) {
  const layout = state.layouts[state.spaceId];
  const view = findLeaf(layout.root, layout.focusId)?.view;
  return view?.kind === 'thread' ? view.id : undefined;
}

