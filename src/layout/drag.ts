import { useSyncExternalStore } from 'react';
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

/** Drag ghosts are `pointer-events: none`, so the topmost leaf under the pointer is the target. Tab strips and the sidebar are never targets; for a pane tab neither is a thread header (it pins there instead) nor a side pane. A pane tab never replaces a split, it always opens beside one. */
function hitLeaf(x: number, y: number, view: View): DragSession['hit'] {
  const els = document.elementsFromPoint(x, y);
  const blocked = view.kind === 'tab' ? '[role=tablist], [data-sidebar=sidebar], [data-pin-drop], [data-side-pane]' : '[role=tablist], [data-sidebar=sidebar]';
  if (els.some((el) => el.closest(blocked))) return null;
  const leafEl = els.map((el) => el.closest<HTMLElement>('[data-leaf-id]')).find(Boolean);
  if (!leafEl) return null;
  return { leafId: leafEl.dataset.leafId!, zone: zoneAt(leafEl.getBoundingClientRect(), x, y, view.kind !== 'tab') };
}
