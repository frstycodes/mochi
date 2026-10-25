/** Degrees a dragged item leans when held `grabX` px from its left edge: right end dips when held left, level when held centred. */
export function tiltFor(grabX: number, width: number) {
  if (width <= 0) return 0;
  const fromCentre = 1 - (2 * Math.min(Math.max(grabX, 0), width)) / width;
  return MAX_TILT_DEG * fromCentre;
}

const MAX_TILT_DEG = 4;
