import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type Axis = 'x' | 'y';

/**
 * Glue for a native paging scroller (`snap-mandatory` + `snap-always` pages): the browser owns tracking, momentum and the one-page-per-gesture stop.
 * This only reports the page the scroll came to rest on, and puts the scroller on `index` when it changes from elsewhere (keys, clicks).
 */
export function useSnapPager(ref: RefObject<HTMLElement | null>, { axis, index, onSettle }: { axis: Axis; index: number; onSettle: (page: number) => void }) {
  const latest = useRef({ index, onSettle });
  latest.current = { index, onSettle };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onEnd = () => {
      const page = pageOf(el, axis);
      if (page !== latest.current.index) latest.current.onSettle(page);
    };
    el.addEventListener('scrollend', onEnd);
    return () => el.removeEventListener('scrollend', onEnd);
  }, [ref, axis]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pageOf(el, axis) === index) return;
    // Instant: the change came from a key or a click, and DESIGN.md keeps keyboard navigation unanimated.
    el.scrollTo({ [axis === 'x' ? 'left' : 'top']: index * pageSize(el, axis), behavior: 'instant' });
  }, [ref, axis, index]);
}

export function pageSize(el: HTMLElement, axis: Axis) {
  return (axis === 'x' ? el.clientWidth : el.clientHeight) || 1;
}

function pageOf(el: HTMLElement, axis: Axis) {
  return Math.round((axis === 'x' ? el.scrollLeft : el.scrollTop) / pageSize(el, axis));
}
