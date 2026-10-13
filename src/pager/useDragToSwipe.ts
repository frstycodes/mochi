import { useEffect, type RefObject } from 'react';
import { pageSize } from '../useSnapPager';
import { releasePage } from './slots';

const AXIS_LOCK_PX = 6;

/**
 * Mouse press-and-drag pages the scroller like a two-finger swipe: 1:1 with the hand once the drag locks horizontal, then on release
 * one page by distance or flick. It starts only on empty space (never on text, so selecting still works, nor on controls), and a vertical
 * lock lets go. Snap is off while the hand drives and comes back once the page is reached, so it can't pull to the nearest page midway.
 */
export function useDragToSwipe(ref: RefObject<HTMLElement | null>, reduce: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let drag: { id: number; x: number; y: number; left: number; isLocked: boolean; lastX: number; lastT: number; velocity: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !canStartSwipe(e)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, isLocked: false, lastX: e.clientX, lastT: e.timeStamp, velocity: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.isLocked) {
        const dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) return void (drag = null);
        drag.isLocked = true;
        el.setPointerCapture(e.pointerId);
        el.dataset.swiping = '';
        el.style.scrollSnapType = 'none';
        window.getSelection()?.removeAllRanges();
      }
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.velocity = (e.clientX - drag.lastX) / dt;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      el.scrollLeft = drag.left - dx;
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { isLocked, left, velocity, lastT } = drag;
      drag = null;
      if (!isLocked) return;
      delete el.dataset.swiping;
      swallowNextClick();
      const width = pageSize(el, 'x');
      const count = Math.round(el.scrollWidth / width);
      // A hand that stopped before letting go is no flick.
      const speed = e.timeStamp - lastT > 80 ? 0 : -velocity;
      const target = releasePage(Math.round(left / width), el.scrollLeft - left, width, speed, count) * width;
      land(el, target, reduce);
    };
    const onCancel = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { isLocked, left } = drag;
      drag = null;
      if (!isLocked) return;
      delete el.dataset.swiping;
      land(el, left, true);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [ref, reduce]);
}

/** Scrolls to the page, then restores snap. `scrollend` is what commits the page (`useSnapPager`), so it fires even when no scroll was left to do. */
function land(el: HTMLElement, left: number, isInstant: boolean) {
  const restore = () => el.style.removeProperty('scroll-snap-type');
  if (isInstant || Math.abs(el.scrollLeft - left) < 1) {
    el.scrollTo({ left, behavior: 'instant' });
    restore();
    el.dispatchEvent(new Event('scrollend'));
    return;
  }
  el.addEventListener('scrollend', restore, { once: true });
  el.scrollTo({ left, behavior: 'smooth' });
}

const NO_SWIPE = 'button, a, input, textarea, select, label, summary, img, video, canvas, iframe, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [role="separator"], [role="tab"], [role="menuitem"], [draggable="true"], .cm-editor, .xterm, .app-drag';

/** Empty space only: not a control, not text the press would start selecting. */
function canStartSwipe(e: PointerEvent) {
  if (!(e.target instanceof Element) || e.target.closest(NO_SWIPE)) return false;
  return !isOverText(e.clientX, e.clientY);
}

function isOverText(x: number, y: number) {
  const node = document.caretPositionFromPoint?.(x, y)?.offsetNode;
  if (node?.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
  // The caret position is the nearest text even off it; only a press inside one of its line boxes starts a selection.
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}

/** The pointerup ending a drag is followed by a click on whatever is under it; that click belongs to the drag. */
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
