import { createElement, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { Accessibility, AutoScroller, Cursor, defaultPreset, Feedback, PointerActivationConstraints, PointerSensor, type Droppable } from '@dnd-kit/dom';
import { DOMRectangle } from '@dnd-kit/dom/utilities';
import { DragDropProvider } from '@dnd-kit/react';
import { zoneAt, type View, type Zone } from './tree.ts';

export interface DragSession {
  view: View;
  label: string;
  /** Sources that draw their own lifted copy (sidebar rows) skip the shared chip. */
  hasOwnGhost: boolean;
  /** Why this view can't open in a split; the drop zone says so and the drop does nothing. */
  refusal?: string;
  x: number;
  y: number;
  hit: { leafId: string; zone: Zone } | null;
}

let session: DragSession | null = null;
const listeners = new Set<() => void>();

function emit(next: DragSession | null) {
  session = next;
  for (const l of listeners) l();
}

type DragOptions = Partial<Pick<DragSession, 'hasOwnGhost' | 'refusal'>>;

export function startDrag(view: View, label: string, x: number, y: number, { hasOwnGhost = false, refusal }: DragOptions = {}) {
  emit({ view, label, hasOwnGhost, refusal, x, y, hit: hitLeaf(x, y, view) });
}

export function moveDrag(x: number, y: number) {
  if (session) emit({ ...session, x, y, hit: hitLeaf(x, y, session.view) });
}

/** Ends the drag and returns where it landed on a split, if anywhere. */
export function endDrag() {
  const landed = session?.hit && !session.refusal ? { ...session.hit, view: session.view } : null;
  emit(null);
  return landed;
}

/** Esc: the drop zones go away and the release lands nowhere. */
export function cancelDrag() {
  emit(null);
}

export function useDragSession() {
  return useDragSelector((s) => s);
}

/** Re-renders only when `select`'s result changes, not on every pointer move. `select` must return a primitive or a stable reference. */
export function useDragSelector<T>(select: (s: DragSession | null) => T) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(session),
  );
}

/** A composer marks itself `data-mention-drop`; a thread released over it is mentioned there (`MENTION_DROP_EVENT`), never opened in a split. */
export const MENTION_DROP_EVENT = 'mochi:mention-thread';

export function mentionDropAt(x: number, y: number) {
  return document.elementsFromPoint(x, y).map((el) => el.closest<HTMLElement>('[data-mention-drop]')).find(Boolean) ?? null;
}

/** Drag ghosts are `pointer-events: none`, so the topmost leaf under the pointer is the target. Tab strips and the sidebar are never targets; for a pane tab neither is a thread header (it pins there instead) nor a side pane. A pane tab never replaces a split, it always opens beside one. */
function hitLeaf(x: number, y: number, view: View): DragSession['hit'] {
  const els = document.elementsFromPoint(x, y);
  const blocked = view.kind === 'tab' ? '[role=tablist], [data-sidebar=sidebar], [data-pin-drop], [data-side-pane]' : '[role=tablist], [data-sidebar=sidebar], [data-mention-drop]';
  if (els.some((el) => el.closest(blocked))) return null;
  const leafEl = els.map((el) => el.closest<HTMLElement>('[data-leaf-id]')).find(Boolean);
  if (!leafEl) return null;
  return { leafId: leafEl.dataset.leafId!, zone: zoneAt(leafEl.getBoundingClientRect(), x, y, view.kind !== 'tab') };
}

export type SurfaceHandlers = Pick<ComponentProps<typeof DragDropProvider>, 'onDragStart' | 'onDragMove' | 'onDragOver' | 'onDragEnd'>;

/**
 * One drag source's dnd-kit provider: pointer only (Enter on a row must still open it), nothing moved in place (sources draw their
 * own ghost or the shared chip), Esc cancels. `canStart` gets the pressed element, any without it; `autoScroll` scrolls vertically
 * near the edges. `distance`, `canStart` and `autoScroll` are read once.
 */
export function DragSurface({ distance, canStart, autoScroll = false, children, ...handlers }: { distance: number; canStart?: (target: Element) => boolean; autoScroll?: boolean; children: ReactNode } & SurfaceHandlers) {
  const [sensors] = useState(() => [
    PointerSensor.configure({
      activationConstraints: () => [new PointerActivationConstraints.Distance({ value: distance })],
      preventActivation: (e) => !!canStart && !(e.target instanceof Element && canStart(e.target)),
    }),
  ]);
  const [plugins] = useState(() => [
    ...defaultPreset.plugins.filter((p) => p !== Accessibility && p !== Cursor && p !== Feedback && p !== AutoScroller),
    Feedback.configure({ feedback: 'none' }),
    ...(autoScroll ? [AutoScroller.configure({ threshold: { x: 0, y: EDGE_SCROLL_SHARE } })] : []),
  ]);
  // dnd-kit computes collisions only once a shape is set, and again whenever it changes: Feedback keeps it under the pointer, but
  // `feedback: 'none'` skips that, so the surface does it.
  const onDragStart: SurfaceHandlers['onDragStart'] = (event, manager) => {
    const element = manager.dragOperation.source?.element;
    const start = element && new DOMRectangle(element);
    dragStarts.set(manager, start);
    if (start) manager.dragOperation.shape = start;
    handlers.onDragStart?.(event, manager);
  };
  const onDragMove: SurfaceHandlers['onDragMove'] = (event, manager) => {
    const { transform } = manager.dragOperation;
    const start = dragStarts.get(manager);
    if (start) manager.dragOperation.shape = start.translate(transform.x, transform.y);
    handlers.onDragMove?.(event, manager);
  };
  return createElement(DragDropProvider, { sensors, plugins, ...handlers, onDragStart, onDragMove }, children);
}

/** The dragged source's rect at the start, per surface's manager: each runs one drag at a time. */
const dragStarts = new WeakMap<object, DOMRectangle | undefined>();

// About 40px of a full-height sidebar.
const EDGE_SCROLL_SHARE = 0.05;

/** A droppable hit only while the pointer is over the middle half of its height: the rest of the row is for reordering. */
export const middleHalf: Droppable['collisionDetector'] = ({ droppable, dragOperation }) => {
  // Typed over dnd-kit's abstract droppable; the DOM one, with an element, is what `useDroppable` registers. Measured live, not from
  // `droppable.shape`: rows gliding to a new slot move by transform.
  const rect = (droppable as unknown as Droppable).element?.getBoundingClientRect();
  const { x, y } = dragOperation.position.current;
  if (!rect || x < rect.left || x > rect.right || y < rect.top + rect.height / 4 || y > rect.bottom - rect.height / 4) return null;
  // Type 2 is CollisionType.PointerIntersection and priority 2 is CollisionPriority.Normal; both enums live in @dnd-kit/abstract.
  return { id: droppable.id, value: 1, type: 2, priority: 2 };
};
