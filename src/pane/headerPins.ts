import type { RefObject } from 'react';
import { PANE_TAB_KINDS, type PaneTabKind } from '../model.ts';
import { useDragSelector } from '../layout/drag.ts';
import { getPrefs, setPrefs, usePrefs } from '../settings/prefs.ts';

// A visual needs a chat visual to show, so it can't open from a pin.
const isPinnable = (kind: string): kind is Exclude<PaneTabKind, 'visual'> => kind !== 'visual' && (PANE_TAB_KINDS as readonly string[]).includes(kind);

export const PINNABLE_KINDS = PANE_TAB_KINDS.filter(isPinnable);
export type PinnableKind = (typeof PINNABLE_KINDS)[number];

/** Saved pins can name a kind that no longer exists; those are dropped on read. */
export function useHeaderPins() {
  return usePrefs().headerPins.filter(isPinnable);
}

export function setPinned(kind: PaneTabKind, isPinned: boolean) {
  if (!isPinnable(kind)) return;
  const others = getPrefs().headerPins.filter((k) => k !== kind);
  setPrefs({ headerPins: isPinned ? [...others, kind] : others });
}

/** The thread header marks itself `data-pin-drop`; a pane released over it gets pinned. */
export function isOverPinDrop(x: number, y: number) {
  return document.elementsFromPoint(x, y).some((el) => el.closest('[data-pin-drop]'));
}

/** While a pane is being dragged: whether it's over this header. Selectors, not the whole session: re-rendering the header on every pointer move froze Motion's drag of the pane tab (its pointer stopped updating after the first move). */
export function usePinDrop(header: RefObject<HTMLElement | null>) {
  const isDragging = useDragSelector((s) => s?.view.kind === 'tab');
  const isOver = useDragSelector((s) => s?.view.kind === 'tab' && !!header.current && isInside(header.current, s.x, s.y));
  return { isDragging, isOver };
}

export function isInside(el: Element, x: number, y: number) {
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
