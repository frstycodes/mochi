import { useEffect, useState, type RefObject } from 'react';
import { PANE_TAB_KINDS, type PaneTabKind } from '../model.ts';
import { useDragSession } from '../layout/drag.ts';
import { getPrefs, setPrefs, usePrefs } from '../settings/prefs.ts';

const isPinnable = (kind: string): kind is Exclude<PaneTabKind, 'new'> => kind !== 'new' && (PANE_TAB_KINDS as readonly string[]).includes(kind);

export const PINNABLE_KINDS = PANE_TAB_KINDS.filter(isPinnable);

/** Saved pins can name a kind that no longer exists; those are dropped on read. */
export function useHeaderPins() {
  return usePrefs().headerPins.filter(isPinnable);
}

export function setPinned(kind: PaneTabKind, isPinned: boolean) {
  if (!isPinnable(kind)) return;
  const others = getPrefs().headerPins.filter((k) => k !== kind);
  setPrefs({ headerPins: isPinned ? [...others, kind] : others });
}

/** The thread header marks itself `data-pin-drop`; a side pane tab released over it gets pinned. */
export function isOverPinDrop(x: number, y: number) {
  return document.elementsFromPoint(x, y).some((el) => el.closest('[data-pin-drop]'));
}

/** While a side pane tab is being dragged: whether it's over this header. */
export function usePinDrop(header: RefObject<HTMLElement | null>) {
  const session = useDragSession();
  const isDragging = session?.view.kind === 'tab';
  const [isOver, setOver] = useState(false);
  useEffect(() => {
    setOver(!!session && isDragging && !!header.current && isInside(header.current, session.x, session.y));
  }, [session, isDragging, header]);
  return { isDragging, isOver };
}

export function isInside(el: Element, x: number, y: number) {
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
