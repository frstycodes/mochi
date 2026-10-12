import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export type Axis = 'x' | 'y';

/**
 * Glue for a native paging scroller (`snap-mandatory` + `snap-always` pages): the browser owns tracking, momentum and the one-page-per-gesture stop.
 * This only reports the page the scroll came to rest on, and puts the scroller on `index` when it changes from elsewhere (keys, clicks).
 * `onCross` fires each time the page nearest the centre changes, mid-swipe and on a key or click, never for the restore at mount.
 */
export function useSnapPager(ref: RefObject<HTMLElement | null>, { axis, index, onSettle, onCross }: { axis: Axis; index: number; onSettle: (page: number) => void; onCross?: () => void }) {
  const latest = useRef({ index, onSettle, onCross });
  latest.current = { index, onSettle, onCross };
  const nearest = useRef(nearestPage(index));
  const isMounted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    nearest.current.set(pageOf(el, axis));
    const onScroll = () => nearest.current.cross(pageOf(el, axis)) && latest.current.onCross?.();
    const onEnd = () => {
      const page = pageOf(el, axis);
      if (page !== latest.current.index) latest.current.onSettle(page);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onEnd);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onEnd);
    };
  }, [ref, axis]);

  useLayoutEffect(() => {
    const el = ref.current;
    const isRestore = !isMounted.current;
    isMounted.current = true;
    if (!el || pageOf(el, axis) === index) return;
    nearest.current.set(index);
    if (!isRestore) latest.current.onCross?.();
    // Instant: the change came from a key or a click, and DESIGN.md keeps keyboard navigation unanimated.
    el.scrollTo({ [axis === 'x' ? 'left' : 'top']: index * pageSize(el, axis), behavior: 'instant' });
  }, [ref, axis, index]);
}

/** The page nearest the centre: `cross` reports a move to a new one, `set` moves it silently, before a programmatic scroll. */
export function nearestPage(start: number) {
  let current = start;
  return {
    cross(page: number) {
      if (page === current) return false;
      current = page;
      return true;
    },
    set(page: number) {
      current = page;
    },
  };
}

export function pageSize(el: HTMLElement, axis: Axis) {
  return (axis === 'x' ? el.clientWidth : el.clientHeight) || 1;
}

function pageOf(el: HTMLElement, axis: Axis) {
  return Math.round((axis === 'x' ? el.scrollLeft : el.scrollTop) / pageSize(el, axis));
}
