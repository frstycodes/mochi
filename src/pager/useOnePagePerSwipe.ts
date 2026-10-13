import { useEffect, type RefObject } from 'react';
import { pageSize } from '../useSnapPager';
import { clampToNeighbours, swipeStarts } from './slots';

// Scrolls this long after the last wheel event still belong to the swipe (the snap settling); others are keys and clicks, which may jump further.
const SWIPE_TAIL_MS = 400;

/**
 * One swipe turns at most one page. `scroll-snap-stop: always` only holds once the fingers lift: while they track 1:1, Chromium lets a
 * long swipe run past the next page and then snaps to the one beyond. So each swipe gets a home (the page it started from) and the
 * offset is held within a page of it. Passive listeners only: a blocking wheel listener here would make every chat scroll wait on the main thread.
 */
export function useOnePagePerSwipe(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pageOf = () => Math.round(el.scrollLeft / pageSize(el, 'x'));
    let home = pageOf();
    let lastWheel = -Infinity;
    let tail = 0;
    const isSwipeStart = swipeStarts(SWIPE_TAIL_MS);
    // Home moves only when a new swipe starts, never on `scrollend`: holding the offset is a main-thread scroll, which raises its own scrollend mid-swipe.
    const onWheel = (e: WheelEvent) => {
      if (isSwipeStart(e.timeStamp, e.deltaX, e.deltaY)) home = pageOf();
      lastWheel = e.timeStamp;
      // The page commits once the swipe is over (`data-wheeling` holds it off): a commit mid-swipe re-renders on the main thread while the
      // compositor keeps scrolling, so the offset ran past the held page before the next check.
      el.dataset.wheeling = '';
      clearTimeout(tail);
      tail = window.setTimeout(() => {
        delete el.dataset.wheeling;
        el.dispatchEvent(new Event('scrollend'));
      }, SWIPE_TAIL_MS);
    };
    // Holding the offset from the main thread while the compositor drives the swipe can leave Chromium's snap resting between pages; finish it.
    const onEnd = () => {
      if (el.dataset.wheeling !== undefined || el.dataset.swiping !== undefined) return;
      const width = pageSize(el, 'x');
      const left = Math.round(el.scrollLeft / width) * width;
      if (Math.abs(el.scrollLeft - left) > 1) el.scrollTo({ left, behavior: 'smooth' });
    };
    const onScroll = () => {
      if (performance.now() - lastWheel > SWIPE_TAIL_MS) return;
      const left = clampToNeighbours(el.scrollLeft, home, pageSize(el, 'x'));
      if (left !== el.scrollLeft) el.scrollLeft = left;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onEnd);
    return () => {
      clearTimeout(tail);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onEnd);
    };
  }, [ref]);
}

