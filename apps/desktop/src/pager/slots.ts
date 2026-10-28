import { pinnedThreads } from '../reorder.ts';
import { findLeaf, leaves } from '@mochi/domain/layout/tree';
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
export function pagerSlots(
  pinned: string[],
  onScreen: string[],
  focusedId: string | undefined,
): PagerSlots {
  const ids = pinned.filter((id) => id === focusedId || !onScreen.includes(id));
  const center = focusedId === undefined ? -1 : ids.indexOf(focusedId);
  if (center >= 0) return { ids, center };
  return { ids: [OFF_PIN, ...ids], center: 0 };
}

/** `threads`: the sidebar's list when other computers' pins count (`useMergedThreads`), else this computer's own. */
export function slotsOf(
  state: State,
  threads: State['threads'] = state.threads,
): PagerSlots {
  const layout = state.layouts[state.spaceId];
  const onScreen = leaves(layout.root).flatMap((l) =>
    l.view.kind === 'thread' ? [l.view.id] : [],
  );
  const view = findLeaf(layout.root, layout.focusId)?.view;
  const pinned = pinnedThreads(threads, state.spaceId).map((t) => t.id);
  return pagerSlots(
    pinned,
    onScreen,
    view?.kind === 'thread' ? view.id : undefined,
  );
}

/** The pinned thread `step` pages from the current one, if there is one. */
export function pinnedNeighbour({ ids, center }: PagerSlots, step: 1 | -1) {
  const id = ids[center + step];
  return id && id !== OFF_PIN ? id : undefined;
}
