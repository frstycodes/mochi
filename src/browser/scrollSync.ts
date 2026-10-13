export interface ScrollPoint {
  x: number;
  y: number;
}

const same = (a: ScrollPoint, b: ScrollPoint) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

/**
 * One step of keeping two pages scrolled together: whichever page moved since the last synced position leads, the other follows.
 * `last` is the position both were last synced at (null before the first step, when `a` leads). Returns what to move, or null.
 */
export function nextScrollSync(last: ScrollPoint | null, a: ScrollPoint, b: ScrollPoint): { move: 'a' | 'b'; to: ScrollPoint } | null {
  if (same(a, b)) return null;
  if (!last || !same(a, last)) return { move: 'b', to: a };
  return { move: 'a', to: b };
}
