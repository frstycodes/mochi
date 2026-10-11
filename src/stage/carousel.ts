/** Stage Manager carousel: which thread sits where, and how each edge card is posed for a scroll position. Pure, so `node --test` covers it. */

export interface StageSlots {
  /** Thread ids in carousel order; `ids[center]` is the focused thread (or `CENTER` when the stage shows something that isn't a pinned thread). */
  ids: string[];
  center: number;
}

export const CENTER = '';

/** Edge cards visible per side; the rest collapse into the last one, which shows a count. */
export const STACK_VISIBLE = 3;

/**
 * Pinned threads in pin order, with the focused thread at its own pin position. Other threads already on stage (in the center split group) leave the edges.
 * An unpinned or non-thread center sits before the first pin, so every pin is on the right.
 */
export function stageSlots(pinned: string[], onStage: string[], focusedId: string | undefined): StageSlots {
  const edges = pinned.filter((id) => id === focusedId || !onStage.includes(id));
  const center = focusedId === undefined ? -1 : edges.indexOf(focusedId);
  if (center >= 0) return { ids: edges, center };
  return { ids: [CENTER, ...edges], center: 0 };
}

/** Opt-in: needs-you threads move nearest the center on their own side; everything else keeps pin order. */
export function needsYouNearCenter({ ids, center }: StageSlots, needsYou: (id: string) => boolean): StageSlots {
  const left = ids.slice(0, center);
  const right = ids.slice(center + 1);
  const byNeed = (side: string[], isNearAtEnd: boolean) => {
    const calm = side.filter((id) => !needsYou(id));
    const urgent = side.filter(needsYou);
    return isNearAtEnd ? [...calm, ...urgent] : [...urgent, ...calm];
  };
  return { ids: [...byNeed(left, true), ids[center], ...byNeed(right, false)], center };
}

export interface CardGeometry {
  /** How far the nearest card sticks out from the window edge, px. */
  visible: number;
  /** Each card further back sticks out this much less. */
  recede: number;
  /** A card moving to the center travels this far inward before it hands over to the live view. */
  travel: number;
  /** Deck offset along the edge per card further back, px. */
  fan: number;
  rotate: number;
}

export const GEOMETRY = { visible: 36, recede: 8, travel: 140, fan: 26, rotate: 42 } satisfies CardGeometry;

export interface CardPose {
  /** Inward from the window edge to the card's inner edge, px. */
  inset: number;
  /** Along the edge, px (negative is up in landscape, left in portrait). */
  fan: number;
  depth: number;
  rotate: number;
  scale: number;
  opacity: number;
  z: number;
}

/**
 * Pose of the card `d` slots from the scroll position (`i - pos`): |d| ≥ 1 sits in its side's deck, nearer cards larger and less receded;
 * 0 < |d| < 1 fades out within the first fifth of the way, as its real page (rendered beside the center) slides in. Past `STACK_VISIBLE` cards share the last card's pose, then fade out.
 */
export function cardPose(d: number, isFlat: boolean, g: CardGeometry = GEOMETRY): CardPose {
  const a = Math.abs(d);
  const z = 100 - Math.round(a * 10);
  if (a < 1) {
    const t = 1 - a;
    return { inset: g.visible + t * g.travel, fan: 0, depth: 0, rotate: isFlat ? 0 : g.rotate * (1 - t / 2), scale: 1, opacity: smoothstep(0.8, 1, a), z };
  }
  const k = Math.min(a - 1, STACK_VISIBLE - 1);
  const beyond = a - STACK_VISIBLE;
  return {
    inset: g.visible - k * g.recede,
    fan: -k * g.fan,
    depth: isFlat ? 0 : -k * 60,
    rotate: isFlat ? 0 : g.rotate,
    scale: isFlat ? 1 : 1 - k * 0.07,
    opacity: beyond <= 0 ? 1 : Math.max(0, 1 - beyond),
    z,
  };
}

/** The deck's last visible card carries the count of everything stacked under it, itself included; null when nothing is stacked. */
export function stackCount(i: number, { ids, center }: StageSlots) {
  const side = i < center ? center : ids.length - 1 - center;
  const isStackTop = Math.abs(i - center) === STACK_VISIBLE;
  return isStackTop && side > STACK_VISIBLE ? side - STACK_VISIBLE + 1 : null;
}

function smoothstep(from: number, to: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
