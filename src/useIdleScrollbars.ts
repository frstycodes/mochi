import { useEffect } from 'react';

const IDLE_MS = 700;
const INPUT_WINDOW_MS = 400;
const INPUTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * Marks whichever element is scrolling with data-scrolling until it has been still for IDLE_MS.
 * Only user-driven scrolls count: the chat auto-scrolls on every new message and shouldn't flash its bar.
 */
export function useIdleScrollbars() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    let lastInput = 0;
    const onInput = () => (lastInput = performance.now());
    const onScroll = (e: Event) => {
      if (performance.now() - lastInput > INPUT_WINDOW_MS) return;
      lastInput = performance.now();
      const el =
        e.target instanceof Element ? e.target : document.documentElement;
      el.setAttribute('data-scrolling', '');
      window.clearTimeout(timers.get(el));
      timers.set(
        el,
        window.setTimeout(() => el.removeAttribute('data-scrolling'), IDLE_MS),
      );
    };
    INPUTS.forEach((t) =>
      document.addEventListener(t, onInput, { capture: true, passive: true }),
    );
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      INPUTS.forEach((t) =>
        document.removeEventListener(t, onInput, { capture: true }),
      );
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);
}
