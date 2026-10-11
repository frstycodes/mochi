import { useSyncExternalStore } from 'react';
import { zoneAt, type Side, type View, type Zone } from './tree.ts';

export interface DragSession {
  view: View;
  label: string;
  /** Sources that draw their own lifted copy (sidebar rows) skip the shared chip. */
  hasOwnGhost: boolean;
  /** Sources that only ever open beside a split (Stage Manager cards) turn the replace zone into this side. */
  centerAs?: Side;
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

export function startDrag(view: View, label: string, x: number, y: number, hasOwnGhost = false, centerAs?: Side) {
  emit({ view, label, hasOwnGhost, centerAs, x, y, hit: hitLeaf(x, y, centerAs) });
}

export function moveDrag(x: number, y: number) {
  if (session) emit({ ...session, x, y, hit: hitLeaf(x, y, session.centerAs) });
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
function hitLeaf(x: number, y: number, centerAs?: Side): DragSession['hit'] {
  const els = document.elementsFromPoint(x, y);
  if (els.some((el) => el.closest('[role=tablist], [data-sidebar=sidebar]'))) return null;
  const leafEl = els.map((el) => el.closest<HTMLElement>('[data-leaf-id]')).find(Boolean);
  if (!leafEl) return null;
  const zone = zoneAt(leafEl.getBoundingClientRect(), x, y);
  return { leafId: leafEl.dataset.leafId!, zone: zone === 'center' && centerAs ? centerAs : zone };
}
