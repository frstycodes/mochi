import { useSyncExternalStore } from 'react';
import { zoneAt, type View, type Zone } from './tree.ts';

export interface DragSession {
  view: View;
  label: string;
  /** Sources that draw their own lifted copy (sidebar rows) skip the shared chip. */
  hasOwnGhost: boolean;
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

export function startDrag(view: View, label: string, x: number, y: number, hasOwnGhost = false) {
  emit({ view, label, hasOwnGhost, x, y, hit: hitLeaf(x, y) });
}

export function moveDrag(x: number, y: number) {
  if (session) emit({ ...session, x, y, hit: hitLeaf(x, y) });
}

/** Ends the drag and returns where it landed on a split, if anywhere. */
export function endDrag() {
  const landed = session?.hit ? { ...session.hit, view: session.view } : null;
  emit(null);
  return landed;
}

export function useDragSession() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );
}

/** Drag ghosts are `pointer-events: none`, so the topmost leaf under the pointer is the target. Tab strips and the sidebar are never targets. */
function hitLeaf(x: number, y: number): DragSession['hit'] {
  const els = document.elementsFromPoint(x, y);
  if (els.some((el) => el.closest('[role=tablist], [data-sidebar=sidebar]'))) return null;
  const leafEl = els.map((el) => el.closest<HTMLElement>('[data-leaf-id]')).find(Boolean);
  if (!leafEl) return null;
  return { leafId: leafEl.dataset.leafId!, zone: zoneAt(leafEl.getBoundingClientRect(), x, y) };
}
