import { useLayoutEffect, type RefObject } from 'react';
import { lightsEnd } from './appZoom';
import { host } from './host';
import { IS_MAC } from './keys';

/** The desktop app on Windows, where the native min / max / close sit over the page's top-right corner (`titleBarOverlay` in `electron/window.ts`). */
export const HAS_CAPTIONS = host.isDesktop && /Windows/.test(navigator.userAgent);

const HAS_LIGHTS = host.isDesktop && IS_MAC;

const HEADER_PX = 44;

/**
 * Marks the header with `data-under-captions` while it sits under Windows' caption buttons, and `data-under-lights` (with its
 * left edge in `--header-left`) while it sits under the macOS traffic lights; `index.css` pads it clear of them. Only headers
 * that can land in a window corner need it: an expanded pane, a split, a popped-out pane.
 */
export function useCaptionInset(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!(HAS_CAPTIONS || HAS_LIGHTS) || !el) return;
    const check = () => {
      const { top, left, right } = el.getBoundingClientRect();
      const isTop = top < HEADER_PX;
      if (HAS_CAPTIONS) el.toggleAttribute('data-under-captions', isTop && right >= document.documentElement.clientWidth - 1);
      if (!HAS_LIGHTS) return;
      el.toggleAttribute('data-under-lights', isTop && left < lightsEnd());
      el.style.setProperty('--header-left', `${Math.max(0, left)}px`);
    };
    // Re-checked only when the header or the window resizes; a header that moves without changing width keeps its last answer.
    const observer = new ResizeObserver(check);
    observer.observe(el);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [ref]);
}
