import { useLayoutEffect, type RefObject } from 'react';
import { host } from './host';

/** The desktop app on Windows, where the native min / max / close sit over the page's top-right corner (`titleBarOverlay` in `electron/window.ts`). */
export const HAS_CAPTIONS = host.isDesktop && /Windows/.test(navigator.userAgent);

const HEADER_PX = 44;

/** Marks the header with `data-under-captions` while it sits under the window's caption buttons; `index.css` pads it clear of them. */
export function useCaptionInset(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!HAS_CAPTIONS || !el) return;
    const check = () => {
      const { top, right } = el.getBoundingClientRect();
      el.toggleAttribute('data-under-captions', top < HEADER_PX && right >= document.documentElement.clientWidth - 1);
    };
    // Re-checked only when the header or the window resizes; a header that moves without changing width keeps its last answer.
    const observer = new ResizeObserver(check);
    observer.observe(el);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [ref]);
}
