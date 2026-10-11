import { useEffect, useRef } from 'react';
import { animate, useMotionValue } from 'motion/react';

export type Step = 1 | -1;
export type Axis = 'x' | 'y';

const COMMIT_FRACTION = 0.3;
const FLICK_PROJECTION = 10;
const EDGE_RESISTANCE = 4;
// The web gets no finger-lift signal for trackpad scrolls. Lift with velocity shows up as macOS momentum (deltas decaying every frame) → settle right away.
// Lift at rest is indistinguishable from resting fingers → settle after HOLD_MS of silence, so a pause shorter than that holds the swipe mid-change.
const MOMENTUM_EVENTS = 6;
const HOLD_MS = 500;
// After a release every event is momentum until the wheel goes quiet this long; macOS momentum tails can pause >140ms, which used to start a second swipe.
const RELEASED_QUIET_MS = 320;
const SETTLE = { type: 'spring', bounce: 0, duration: 0.35 } as const;

/**
 * Canvas-style paging: `pos` (fractional page index) tracks the wheel 1:1, one page being the element's own width (or height), and settles when the gesture ends.
 * At most one page per gesture, momentum after the release is swallowed, and a gesture that starts inside a scroller that can still move that way belongs to it.
 */
export function usePagedSwipe({ index, count, axis, onStep }: { index: number; count: number; axis: Axis; onStep: (step: Step) => void }) {
  const pos = useMotionValue(index);
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef(newGesture());
  const endTimer = useRef(0);
  const canStep = (step: Step) => index + step >= 0 && index + step < count;

  useEffect(() => {
    const controls = animate(pos, index, SETTLE);
    return () => controls.stop();
  }, [index, pos]);

  const pageSize = () => (axis === 'x' ? ref.current?.clientWidth : ref.current?.clientHeight) || 1;

  const release = () => {
    const g = gesture.current;
    g.isReleased = true;
    const step = swipeStep(g.offset, g.lastDelta, pageSize());
    if (step && canStep(step)) onStep(step);
    else animate(pos, index, SETTLE);
  };

  const end = () => {
    const g = gesture.current;
    if (!g.isReleased && g.owner === 'self') release();
    gesture.current = newGesture();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.deltaX && !e.deltaY) return;
    const g = gesture.current;
    const delta = axis === 'x' ? e.deltaX : e.deltaY;
    g.owner ??= ownerOf(e, axis, ref.current);
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(end, g.isReleased ? RELEASED_QUIET_MS : HOLD_MS);
    if (g.owner !== 'self' || g.isReleased) return;

    const isDecaying = Math.sign(delta) === Math.sign(g.lastDelta) && Math.abs(delta) < Math.abs(g.lastDelta);
    g.decaying = isDecaying ? g.decaying + 1 : 0;
    g.lastDelta = delta;
    if (g.decaying >= MOMENTUM_EVENTS) return release();

    const page = pageSize();
    g.offset = clampOffset(g.offset + delta, page);
    const isPastEdge = !canStep(g.offset > 0 ? 1 : -1);
    pos.set(index + g.offset / page / (isPastEdge ? EDGE_RESISTANCE : 1));
  };

  return { pos, ref, onWheel };
}

function newGesture() {
  return { owner: null as 'self' | 'other' | null, offset: 0, lastDelta: 0, decaying: 0, isReleased: false };
}

/** One page of travel at most: the canvas never runs past the neighbour, however long the swipe. */
export function clampOffset(offset: number, page: number) {
  return Math.max(-page, Math.min(page, offset));
}

/** Where a released swipe goes: a third of a page, or a flick whose last delta projects that far, moves one page that way. */
export function swipeStep(offset: number, lastDelta: number, page: number): Step | null {
  const projected = offset + lastDelta * FLICK_PROJECTION;
  if (Math.abs(projected) < page * COMMIT_FRACTION) return null;
  return projected > 0 ? 1 : -1;
}

function ownerOf(e: React.WheelEvent, axis: Axis, root: HTMLElement | null) {
  const isOnAxis = axis === 'x' ? Math.abs(e.deltaX) > Math.abs(e.deltaY) : Math.abs(e.deltaY) > Math.abs(e.deltaX);
  if (!isOnAxis) return 'other';
  const delta = axis === 'x' ? e.deltaX : e.deltaY;
  for (let el = e.target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (canScroll(el, axis, delta)) return 'other';
  }
  return 'self';
}

function canScroll(el: HTMLElement, axis: Axis, delta: number) {
  const overflow = getComputedStyle(el)[axis === 'x' ? 'overflowX' : 'overflowY'];
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  const [at, size, client] = axis === 'x' ? [el.scrollLeft, el.scrollWidth, el.clientWidth] : [el.scrollTop, el.scrollHeight, el.clientHeight];
  return delta > 0 ? at + client < size - 1 : at > 0;
}
