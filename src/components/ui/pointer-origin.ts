import { useCallback, type Ref } from 'react';

type Point = { x: number; y: number };

// The last click or hover point; a key press clears it so keyboard opens grow from the trigger edge instead.
let lastPointer: Point | null = null;
const trackPointer = (event: PointerEvent) => (lastPointer = { x: event.clientX, y: event.clientY });
addEventListener('pointerdown', trackPointer, { capture: true, passive: true });
addEventListener('pointermove', trackPointer, { capture: true, passive: true });
addEventListener('keydown', () => (lastPointer = null), { capture: true, passive: true });

/** Ref for a Radix popper content: sets `--pop-origin` to where the pointer opened it, for `animate-pop`. */
export function usePopOrigin<T extends HTMLElement>(ref: Ref<T> | undefined) {
  return useCallback(
    (panel: T | null) => {
      const cleanupRef = assignRef(ref, panel);
      const stopTracking = panel ? originFromPointer(panel) : undefined;
      return () => {
        stopTracking?.();
        if (cleanupRef) cleanupRef();
        else assignRef(ref, null);
      };
    },
    [ref],
  );
}

// Radix holds the panel at `animation: none` until it is positioned; the observer fires before that frame paints.
function originFromPointer(panel: HTMLElement) {
  const point = lastPointer;
  if (!point) return;
  const observer = new MutationObserver(() => {
    if (panel.style.animationName === 'none') return;
    observer.disconnect();
    // The popper wrapper, because the panel itself starts scaled.
    const box = panel.parentElement!.getBoundingClientRect();
    panel.style.setProperty('--pop-origin', `${point.x - box.left}px ${point.y - box.top}px`);
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
  return () => observer.disconnect();
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') return ref(value);
  if (ref) ref.current = value;
}
