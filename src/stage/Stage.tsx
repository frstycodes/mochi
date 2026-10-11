import { startTransition, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { cn } from '@/lib/utils';
import { endDrag, moveDrag, startDrag } from '../layout/drag';
import { findLeaf, leaves, type Side } from '../layout/tree';
import { Workspace } from '../layout/Workspace';
import { pinnedThreads } from '../reorder';
import { useHarness, type State } from '../store';
import { CENTER, cardPose, needsYouNearCenter, stackCount, stageSlots, type StageSlots } from './carousel';
import { Overview } from './Overview';
import { SnapshotCard, type StripSide } from './SnapshotCard';
import { useThreadSnapshots, type ThreadSnapshot } from './snapshot';
import { useStageKeys } from './useStageKeys';
import { usePagedSwipe } from '../usePagedSwipe';
import { useWindowSyncHost } from './windowSync';

const CARD = { landscape: { w: 248, h: 176 }, portrait: { w: 248, h: 150 } };
const DRAG_SLOP_PX = 6;

/**
 * The main area. Normally the split workspace; in Stage Manager mode the workspace (one session or a split group) sits centered at 88%
 * and the other pinned threads stick out of the edges as 3D cards. A swipe moves the center 1:1 like a canvas, one card per gesture at most.
 */
export function Stage() {
  const { state, dispatch } = useHarness();
  useWindowSyncHost();
  const reduce = !!useReducedMotion();
  const isStage = state.isStage;
  const isPortrait = state.orientation === 'column';
  const slots = useStageSlots(state);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const open = (id: string) => startTransition(() => dispatch({ type: 'go', view: { kind: 'thread', id } }));
  const openSlot = (i: number) => {
    const id = slots.ids[i];
    if (id && id !== CENTER) open(id);
  };
  const swipe = usePagedSwipe({ index: slots.center, count: slots.ids.length, axis: isPortrait ? 'y' : 'x', onStep: (step) => openSlot(slots.center + step) });

  useStageKeys((step) => openSlot(slots.center + step));

  useLayoutEffect(() => {
    const el = swipe.ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      width.set(el.clientWidth);
      height.set(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [swipe.ref, width, height]);

  const size = isPortrait ? height : width;
  return (
    <div ref={swipe.ref} onWheel={isStage ? swipe.onWheel : undefined} data-stage={isStage || undefined} className={cn('relative flex h-full min-h-0 items-center justify-center overflow-hidden', isStage && 'bg-sidebar')}>
      <CenterFrame isStage={isStage} isPortrait={isPortrait} isFlat={reduce} pos={swipe.pos} center={slots.center} size={size} />
      {isStage && <EdgeCards slots={slots} pos={swipe.pos} size={size} isPortrait={isPortrait} isFlat={reduce} onOpen={openSlot} />}
      {state.isOverview && <Overview />}
    </div>
  );
}

/** The workspace. Always the same element so toggling the stage never remounts the sessions in it. Off rest it slides by exactly the swipe distance. */
function CenterFrame({ isStage, isPortrait, isFlat, pos, center, size }: { isStage: boolean; isPortrait: boolean; isFlat: boolean; pos: MotionValue<number>; center: number; size: MotionValue<number> }) {
  const centerRef = useRef(center);
  centerRef.current = center;
  const dc = useTransform(pos, (p) => (isStage ? centerRef.current - p : 0));
  // `none` at rest: any transform would make this the containing block of the fixed-position layers inside (the pop-out preview).
  const transform = useTransform([dc, size], ([d, px]: number[]) => (isFlat || Math.abs(d) < 0.002 ? 'none' : isPortrait ? `translateY(${d * px}px)` : `translateX(${d * px}px)`));
  const opacity = useTransform(dc, (d) => 1 - Math.min(Math.abs(d), 0.5) * 1.2);
  return (
    <motion.div
      style={{ transform, opacity }}
      className={cn('min-h-0 min-w-0', isStage ? cn('isolate overflow-hidden rounded-xl bg-background ring-1 ring-border', isPortrait ? 'h-[88%] w-[calc(100%-24px)]' : 'h-[calc(100%-24px)] w-[88%]') : 'size-full')}
    >
      <Workspace />
    </motion.div>
  );
}

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
      <button type="button" aria-label={`Open ${snap.title}`} {...drag} className="group size-full cursor-default touch-none rounded-xl outline-none select-none [transform-style:preserve-3d]">
        <div className={cn('size-full transition-[translate,transform] duration-240 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:duration-160 motion-reduce:transition-none', ORIGIN[side], !isFlat && PEEK[side], isFlat && PEEK[side].replace(/\S*rotate\S*/g, ''))}>
          <SnapshotCard snap={snap} strip={STRIP[side]} stacked={stacked} className="size-full group-focus-visible:ring-2 group-focus-visible:ring-ring" />
        </div>
      </button>
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
      startDrag({ kind: 'thread', id: snap.id }, snap.title, e.clientX, e.clientY, false, side);
    },
    onPointerUp: () => {
      const s = start.current;
      start.current = null;
      if (!s?.isDragging) return onOpen();
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

