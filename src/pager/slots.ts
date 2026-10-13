import { pinnedThreads } from '../reorder.ts';
import { findLeaf, leaves } from '../layout/tree.ts';
import type { State } from '../store/index.tsx';

/** The pinned pager: which view sits on which page. Pure, so `node --test` covers it. */

export interface PagerSlots {
  /** Thread ids in page order; `ids[center]` is the focused thread (or `OFF_PIN` when the focused view isn't a pinned thread). */
  ids: string[];
  center: number;
}

export const OFF_PIN = '';

/**
 * Pinned threads in pin order, with the focused thread at its own pin position. Other threads already open in the focused split group leave the pager.
 * An unpinned or non-thread view sits before the first pin, so every pin is to its right.
 */
export function pagerSlots(pinned: string[], onScreen: string[], focusedId: string | undefined): PagerSlots {
  const ids = pinned.filter((id) => id === focusedId || !onScreen.includes(id));
  const center = focusedId === undefined ? -1 : ids.indexOf(focusedId);
  if (center >= 0) return { ids, center };
  return { ids: [OFF_PIN, ...ids], center: 0 };
}

export function slotsOf(state: State): PagerSlots {
  const layout = state.layouts[state.spaceId];
  const onScreen = leaves(layout.root).flatMap((l) => (l.view.kind === 'thread' ? [l.view.id] : []));
  const view = findLeaf(layout.root, layout.focusId)?.view;
  const pinned = pinnedThreads(state.threads, state.spaceId).map((t) => t.id);
  return pagerSlots(pinned, onScreen, view?.kind === 'thread' ? view.id : undefined);
}

/** The pinned thread `step` pages from the current one, if there is one. */
export function pinnedNeighbour({ ids, center }: PagerSlots, step: 1 | -1) {
  const id = ids[center + step];
  return id && id !== OFF_PIN ? id : undefined;
}

/** Pages kept mounted: the current one and one each side, so a swipe slides real content in. */
export function isHot(page: number, center: number) {
  return Math.abs(page - center) <= 1;
}

/** Hand speed (px/ms) that turns the page on release however short the drag. */
export const FLICK_PX_PER_MS = 0.4;

/**
 * Where a mouse drag lands on release: `moved` px of scroll from page `from` (positive = forward), at `velocity` px/ms of scroll.
 * A flick or more than half a page turns one page; never more than one, like a native snap-always swipe.
 */
export function releasePage(from: number, moved: number, pageWidth: number, velocity: number, count: number) {
  const step = Math.abs(velocity) >= FLICK_PX_PER_MS ? Math.sign(velocity) : Math.abs(moved) > pageWidth / 2 ? Math.sign(moved) : 0;
  return Math.min(count - 1, Math.max(0, from + step));
}
