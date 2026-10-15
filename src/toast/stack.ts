import type { Toast } from './store.ts';

// Sonner's stack, read off its source (v2.0.8): three visible, one gap for both the peek behind the front toast
// and the spacing of a fanned-out stack, each slot back 5% smaller, and position, opacity and height moving at 400ms `ease`.
export const VISIBLE = 3;
export const GAP = 14;
const SCALE_STEP = 0.05;
export const STACK_MS = 400;
/** Opening into the widget and collapsing back: as long as the stack's own moves, with size and corners on the drawer curve. */
export const MORPH_MS = STACK_MS;

/** A toast duration, stretched by `--toast-slowmo` (unset = 1) so the motion can be studied frame by frame. */
export const slowmo = (ms: number) => `calc(${ms}ms * var(--toast-slowmo, 1))`;

export type Slot = { index: number; y: number };

/**
 * Sonner's slots. A leaving toast keeps its index until it unmounts, so a folded stack moves up only then; its height drops out
 * at once, so a fanned-out stack closes the gap straight away while the leaving toast holds the offset it had. A toast that has
 * not registered its height yet (it does once mounted) takes no room, so the rest move down only once it has.
 */
export function stackSlots(toasts: Toast[], heights: Record<string, number>) {
  const byId: Record<string, Slot> = {};
  let y = 0;
  toasts.forEach((t, index) => {
    byId[t.id] = { index, y };
    if (!t.isLeaving && t.id in heights) y += heights[t.id] + GAP;
  });
  return { byId, total: Math.max(y - GAP, 0) };
}

/** The opened toast takes the front; every other one counts as past the visible three, so it fades and its timer waits. */
export function openSlots(toasts: Toast[], openId: string) {
  const byId = Object.fromEntries(toasts.map((t) => [t.id, t.id === openId ? { index: 0, y: 0 } : { index: VISIBLE, y: 0 }]));
  return { byId, total: 0 };
}

/** Sonner's positions: in from above, then a peek or a fanned-out offset; leaving, each slot exits its own way. */
export function itemTransform({ slot, isExpanded, isMounted, isLeaving }: { slot: Slot; isExpanded: boolean; isMounted: boolean; isLeaving: boolean }) {
  if (!isMounted) return 'translateY(-100%)';
  const isFront = slot.index === 0;
  if (isLeaving && isFront) return 'translateY(-100%)';
  if (isLeaving && isExpanded) return `translateY(${slot.y}px) translateY(-100%)`;
  if (isLeaving) return 'translateY(40%)';
  if (isExpanded) return `translateY(${slot.y}px)`;
  return `translateY(${slot.index * GAP}px) scale(${1 - slot.index * SCALE_STEP})`;
}

type SizeState = { isFront: boolean; isExpanded: boolean; isMounted: boolean; isMorphing: boolean; canOpen: boolean; height: number; frontHeight: number };

/**
 * Sonner's heights: the front toast of a folded stack sizes itself (`undefined`, auto), the ones behind take the front's height,
 * and a fanned-out toast its own measured one. Between two of those it animates; to or from auto it snaps, as in Sonner.
 * A toast that can open into a widget always has an explicit height: opening swaps its content in the same frame, so from auto
 * the morph would start at the widget's height and run backwards first.
 */
export function itemHeight({ isFront, isExpanded, isMounted, isMorphing, canOpen, height, frontHeight }: SizeState) {
  if (isMorphing) return height;
  if (!isExpanded && !isFront) return frontHeight;
  if (isExpanded && isMounted) return height;
  return canOpen ? height : undefined;
}

const STACK_EASE = 'ease';
const MORPH_EASE = 'var(--ease-drawer)';

/**
 * Durations and curves for transform, opacity, filter, left, right, height and border-radius, in that order (`motionClass`).
 * Everything moves with the stack, as in Sonner, except while the card opens or collapses: then its size and corners keep the
 * drawer curve both ways, so closing doesn't switch curves mid-morph. The blur in and out runs with the fade. A toast leaving from
 * behind a folded stack drops away on Sonner's longer transform and shorter fade.
 */
export function motionTiming({ isLeaving, isFront, isExpanded, isMorphing }: { isLeaving: boolean; isFront: boolean; isExpanded: boolean; isMorphing: boolean }) {
  const isDropping = isLeaving && !isFront && !isExpanded;
  const move = slowmo(isDropping ? 500 : STACK_MS);
  const fade = slowmo(isDropping ? 200 : STACK_MS);
  const size = slowmo(isMorphing ? MORPH_MS : STACK_MS);
  const sizeEase = isMorphing ? MORPH_EASE : STACK_EASE;
  return {
    transitionDuration: [move, fade, fade, size, size, size, size].join(', '),
    transitionTimingFunction: [STACK_EASE, STACK_EASE, STACK_EASE, sizeEase, sizeEase, sizeEase, sizeEase].join(', '),
  };
}
