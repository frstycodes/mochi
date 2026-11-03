import { useEffect } from 'react';
import { host } from './host';
import { IS_MAC } from './keys';

const HAS_TINT = host.isDesktop && IS_MAC;

/**
 * Reports the docked sidebar's visible width to main, which keeps the native tint over macOS vibrancy
 * (electron/sidebarTint) under it. Collapsing slides the sidebar out with a transform, which no ResizeObserver sees,
 * so the width is sampled every frame while the container transitions. Main ignores windows without vibrancy.
 */
export function useSidebarTint() {
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(
      '[data-slot="sidebar-container"]',
    );
    if (!HAS_TINT || !container) return;
    let last = -1;
    let frame = 0;
    let isMoving = false;
    const report = () => {
      const width = Math.max(
        0,
        Math.round(container.getBoundingClientRect().right),
      );
      if (width === last) return;
      last = width;
      void host.windows.tintSidebar(width);
    };
    const tick = () => {
      report();
      frame = isMoving ? requestAnimationFrame(tick) : 0;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const start = (e: TransitionEvent) => {
      if (e.target !== container) return;
      isMoving = true;
      schedule();
    };
    const stop = (e: TransitionEvent) => {
      if (e.target !== container) return;
      isMoving = false;
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    container.addEventListener('transitionrun', start);
    container.addEventListener('transitionend', stop);
    container.addEventListener('transitioncancel', stop);
    return () => {
      observer.disconnect();
      container.removeEventListener('transitionrun', start);
      container.removeEventListener('transitionend', stop);
      container.removeEventListener('transitioncancel', stop);
      cancelAnimationFrame(frame);
      void host.windows.tintSidebar(0);
    };
  }, []);
}
