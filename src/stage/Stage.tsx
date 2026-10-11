import { startTransition, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { cn } from '@/lib/utils';
import { endDrag, moveDrag, startDrag } from '../layout/drag';
import { findLeaf, leaves, type Side } from '../layout/tree';
import { Workspace } from '../layout/Workspace';
import { pinnedThreads } from '../reorder';
import { useHarness, type State } from '../store';
import { CENTER, cardPose, detentIndex, needsYouNearCenter, stackCount, stageSlots, type StageSlots } from './carousel';
import { Overview } from './Overview';
import { SnapshotCard, type StripSide } from './SnapshotCard';
import { useThreadSnapshots, type ThreadSnapshot } from './snapshot';
import { useStageKeys } from './useStageKeys';
import { useWindowSyncHost } from './windowSync';

// Finger travel per card: the strip tracks the scroll 1:1 and every STEP_PX is a detent.
const STEP_PX = 200;
const CARD = { landscape: { w: 248, h: 176 }, portrait: { w: 248, h: 150 } };
const DRAG_SLOP_PX = 6;
// The live center eases a little toward the scroll and dims through the detent, so the swap reads as a crossfade.
const CENTER_SHIFT_PX = 48;

/**
 * The main area. Normally the split workspace; in Stage Manager mode the workspace (one session or a split group) sits centered at 88%
 * and the other pinned threads stick out of the edges as 3D cards. The scroller is a native one: the browser owns tracking, momentum and
 * the snap (scroll-snap), Motion only reads the offset to pose the cards, the same split as the model dock.
 */
export function Stage() {
  const { state } = useHarness();
  useWindowSyncHost();
  const reduce = !!useReducedMotion();
  const isStage = state.isStage;
  const isPortrait = state.orientation === 'column';
  const slots = useStageSlots(state);
  const scroller = useRef<HTMLDivElement>(null);
  const pos = useMotionValue(slots.center);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const live = useRef({ slots, focusedId: focusedThreadId(state), pending: null as string | null });
  live.current = { ...live.current, slots, focusedId: focusedThreadId(state) };
  const { dispatch } = useHarness();

  const scrollTo = (i: number, isAnimated: boolean) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ [isPortrait ? 'top' : 'left']: i * STEP_PX, behavior: isAnimated ? 'smooth' : 'instant' });
  };
  const open = (id: string) => startTransition(() => dispatch({ type: 'go', view: { kind: 'thread', id } }));

  useStageKeys((step) => {
    const { ids, center } = live.current.slots;
    const id = ids[center + step];
    if (id && id !== CENTER) open(id);
  });

  // The center changed from outside the scroller (keys, a click, the sidebar): put the strip on it without animating.
  useLayoutEffect(() => {
    live.current.pending = null;
    const el = scroller.current;
    if (!el || !isStage) return;
    const offset = isPortrait ? el.scrollTop : el.scrollLeft;
    if (detentIndex(offset / STEP_PX, slots.ids.length) !== slots.center) scrollTo(slots.center, false);
    pos.set((isPortrait ? el.scrollTop : el.scrollLeft) / STEP_PX);
  }, [isStage, isPortrait, slots.center, slots.ids.join()]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !isStage) return;
    const p = (isPortrait ? el.scrollTop : el.scrollLeft) / STEP_PX;
    pos.set(p);
    const { slots: s, focusedId, pending } = live.current;
    const id = s.ids[detentIndex(p, s.ids.length)];
    if (id === CENTER || id === focusedId || id === pending) return;
    live.current.pending = id;
    open(id);
  };

  const extra = isStage ? (slots.ids.length - 1) * STEP_PX : 0;
  const axis = isPortrait ? 'y' : 'x';

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div
        ref={scroller}
        onScroll={onScroll}
        data-stage={isStage || undefined}
        // Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility.
        style={isStage ? { scrollbarWidth: 'none', scrollSnapType: `${axis} mandatory`, overscrollBehavior: 'contain' } : undefined}
        className={cn('h-full', isStage ? (isPortrait ? 'overflow-x-hidden overflow-y-auto' : 'overflow-x-auto overflow-y-hidden') : 'overflow-hidden', isStage && 'bg-sidebar')}
      >
        <div className="relative" style={isPortrait ? { width: '100%', height: `calc(100% + ${extra}px)` } : { height: '100%', width: `calc(100% + ${extra}px)` }}>
          {isStage && slots.ids.map((id, i) => <span key={`${id}:${i}`} aria-hidden className="absolute size-px" style={{ [isPortrait ? 'top' : 'left']: i * STEP_PX, scrollSnapAlign: 'start' }} />)}
          <div
            className="sticky top-0 left-0 flex items-center justify-center"
            style={isPortrait ? { width: '100%', height: `calc(100% - ${extra}px)` } : { height: '100%', width: `calc(100% - ${extra}px)` }}
          >
            <CenterFrame isStage={isStage} isPortrait={isPortrait} isFlat={reduce} pos={pos} center={slots.center} />
            {isStage && <EdgeCards slots={slots} pos={pos} size={isPortrait ? height : width} isPortrait={isPortrait} isFlat={reduce} onOpen={(i) => scrollTo(i, !reduce)} />}
          </div>
        </div>
      </div>
      {state.isOverview && <Overview />}
    </div>
  );
}

/** The workspace. Always the same element so toggling the stage never remounts the sessions in it. */
function CenterFrame({ isStage, isPortrait, isFlat, pos, center }: { isStage: boolean; isPortrait: boolean; isFlat: boolean; pos: MotionValue<number>; center: number }) {
  const centerRef = useRef(center);
  centerRef.current = center;
  const dc = useTransform(pos, (p) => (isStage ? centerRef.current - p : 0));
  // `none` at rest: any transform would make this the containing block of the fixed-position layers inside (the pop-out preview).
  const transform = useTransform(dc, (d) => (isFlat || Math.abs(d) < 0.002 ? 'none' : isPortrait ? `translateY(${d * CENTER_SHIFT_PX}px)` : `translateX(${d * CENTER_SHIFT_PX}px)`));
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

