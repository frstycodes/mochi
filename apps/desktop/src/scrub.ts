/** Wheel or drag distance per effort level. 32px stepped twice per short trackpad flick; one level per 64px reads as deliberate. */
export const EFFORT_STEP_PX = 64;
/** Strip px per forwarded wheel px on the model dock. A native swipe over the strip itself stays 1:1, the browser owns it. */
export const DOCK_WHEEL_RATIO = 0.5;
/** Strip px per dragged px on the model dock. */
export const DOCK_DRAG_RATIO = 0.5;

/** A wheel delta in px, whatever its `deltaMode` (lines in Firefox, pages rarely). */
export const wheelPx = (delta: number, deltaMode: number, pageHeight: number) =>
  delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);

/**
 * One wheel event on a stepper sitting at `from` of `count` values: `acc` is the distance carried from earlier events of the
 * gesture. At most one step per event, so a mouse notch is one level, and nothing banked past either end, so reversing
 * answers on the first step back.
 */
export function wheelStep(
  acc: number,
  delta: number,
  from: number,
  count: number,
  stepPx = EFFORT_STEP_PX,
) {
  const total = acc + delta;
  if ((from === 0 && total < 0) || (from === count - 1 && total > 0))
    return { acc: 0, step: 0 };
  if (Math.abs(total) < stepPx) return { acc: total, step: 0 };
  const step = Math.sign(total);
  return {
    acc: Math.abs(total) >= 2 * stepPx ? 0 : total - step * stepPx,
    step,
  };
}

/** Levels a press-and-drag of `distance` px has moved. */
export const dragSteps = (distance: number, stepPx = EFFORT_STEP_PX) =>
  Math.trunc(distance / stepPx);

/** Strip offset for a drag: horizontal moves the strip with the hand (left = forward), vertical runs down = forward. */
export const dockDragOffset = (
  distance: number,
  axis: 'x' | 'y',
  ratio = DOCK_DRAG_RATIO,
) => (axis === 'x' ? -distance : distance) * ratio;
