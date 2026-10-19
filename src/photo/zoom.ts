/** Zoom and pan for the photo viewer. Coordinates are relative to the viewport centre; the image is drawn fitted at scale 1. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };
export const MAX_SCALE = 8;

/** Zooms by `factor` keeping the point under the cursor (`at`) still, then keeps the image covering the viewport where it can. */
export function zoomAt(view: View, factor: number, at: { x: number; y: number }, fitted: Size, viewport: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, view.scale * factor));
  if (scale === 1) return FIT;
  const k = scale / view.scale;
  return clampPan({ scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k }, fitted, viewport);
}

/** An image smaller than the viewport stays centred on that axis; a larger one can't be dragged past its edges. */
export function clampPan(view: View, fitted: Size, viewport: Size): View {
  const maxX = Math.max(0, (fitted.width * view.scale - viewport.width) / 2);
  const maxY = Math.max(0, (fitted.height * view.scale - viewport.height) / 2);
  return { scale: view.scale, x: clamp(view.x, maxX), y: clamp(view.y, maxY) };
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v));

/** A click outside the image's on-screen box closes the viewer; one that ended a pan (moved 4px or more since the press) doesn't. */
export function isBackdropClick(at: Point, press: Point, image: { left: number; top: number; right: number; bottom: number } | undefined) {
  if (Math.hypot(at.x - press.x, at.y - press.y) >= 4) return false;
  return !image || at.x < image.left || at.x > image.right || at.y < image.top || at.y > image.bottom;
}

type Point = { x: number; y: number };
