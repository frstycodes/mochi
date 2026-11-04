/** Strip px per forwarded wheel px on the model dock. A native swipe over the strip itself stays 1:1, the browser owns it. */
export const DOCK_WHEEL_RATIO = 0.5;
/** Strip px per dragged px on the model dock. */
export const DOCK_DRAG_RATIO = 0.5;

/** A wheel delta in px, whatever its `deltaMode` (lines in Firefox, pages rarely). */
export const wheelPx = (delta: number, deltaMode: number, pageHeight: number) =>
  delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);

/** Strip offset for a drag: horizontal moves the strip with the hand (left = forward), vertical runs down = forward. */
export const dockDragOffset = (
  distance: number,
  axis: 'x' | 'y',
  ratio = DOCK_DRAG_RATIO,
) => (axis === 'x' ? -distance : distance) * ratio;
