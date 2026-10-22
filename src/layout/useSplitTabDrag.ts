import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PaneTabKind } from '../model';
import { isOverPinDrop, setPinned } from '../pane/headerPins';
import { useDispatch } from '../store';
import { cancelDrag, endDrag, moveDrag, startDrag } from './drag';

const DRAG_THRESHOLD = 4;

/** Pointer-down handler for a split tab's title: drag it onto another split's edge to move it, onto one of its thread's panes to put it back, onto a thread header to pin its kind. Esc cancels. */
export function useSplitTabDrag(threadId: string, tabId: string, kind: PaneTabKind | undefined, label: string) {
  const dispatch = useDispatch();
  return (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let isDragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        isDragging = true;
        startDrag({ kind: 'tab', threadId, tabId }, label, ev.clientX, ev.clientY);
        document.documentElement.style.userSelect = 'none';
      }
      moveDrag(ev.clientX, ev.clientY);
    };
    const finish = (ev: PointerEvent | null) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      if (!isDragging) return;
      document.documentElement.style.userSelect = '';
      if (!ev) return cancelDrag();
      const landed = endDrag();
      if (isOverPanes(ev.clientX, ev.clientY, threadId)) return dispatch({ type: 'layout-return-tab', threadId, tabId });
      if (kind && isOverPinDrop(ev.clientX, ev.clientY)) return setPinned(kind, true);
      if (landed) dispatch({ type: 'layout-drop', ...landed });
    };
    const onUp = (ev: PointerEvent) => finish(ev);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !isDragging) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };
}

function isOverPanes(x: number, y: number, threadId: string) {
  return document.elementsFromPoint(x, y).some((el) => el.closest(`[data-panes-of="${CSS.escape(threadId)}"]`));
}
