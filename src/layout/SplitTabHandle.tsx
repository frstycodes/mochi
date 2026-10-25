import type { ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/react';
import type { PaneTabKind } from '../model';
import { isOverPinDrop, setPinned } from '../pane/headerPins';
import { useDispatch } from '../store';
import { cancelDrag, DragSurface, endDrag, moveDrag, startDrag } from './drag';

const DRAG_THRESHOLD = 4;

/** A split tab's title: drag it onto another split's edge to move it, onto one of its thread's panes to put it back, onto a thread header to pin its kind. Esc cancels. */
export function SplitTabHandle({
  threadId,
  tabId,
  kind,
  label,
  children,
}: {
  threadId: string;
  tabId: string;
  kind: PaneTabKind;
  label: string;
  children: ReactNode;
}) {
  const dispatch = useDispatch();
  return (
    <DragSurface
      distance={DRAG_THRESHOLD}
      onDragStart={({ operation }) => {
        const { x, y } = operation.position.current;
        startDrag({ kind: 'tab', threadId, tabId }, label, x, y);
      }}
      onDragMove={({ operation }) => {
        const { x, y } = operation.position.current;
        moveDrag(x, y);
      }}
      onDragEnd={({ operation, canceled }) => {
        if (canceled) return cancelDrag();
        const { x, y } = operation.position.current;
        const landed = endDrag();
        if (isOverPanes(x, y, threadId))
          return dispatch({ type: 'layout-return-tab', threadId, tabId });
        if (isOverPinDrop(x, y)) return setPinned(kind, true);
        if (landed) dispatch({ type: 'layout-drop', ...landed });
      }}
    >
      <Handle id={tabId}>{children}</Handle>
    </DragSurface>
  );
}

function Handle({ id, children }: { id: string; children: ReactNode }) {
  const { ref } = useDraggable({ id });
  return (
    // A drag handle: dnd-kit stops the moves reaching Orbit, so a long press here must not open it.
    <span
      ref={ref}
      data-no-orbit
      className="app-no-drag flex min-w-0 cursor-grab items-center gap-2 select-none active:cursor-grabbing"
    >
      {children}
    </span>
  );
}

function isOverPanes(x: number, y: number, threadId: string) {
  return document
    .elementsFromPoint(x, y)
    .some((el) => el.closest(`[data-panes-of="${CSS.escape(threadId)}"]`));
}
