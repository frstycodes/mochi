import { useEffect, type RefObject } from 'react';

const ROW = '[data-sidebar="menu-button"]';
/** Row actions and the chips inside a row (PRs, badges): reachable by pointer, out of the Tab order. */
const NESTED = `[data-sidebar="menu-action"], ${ROW} :is([tabindex], button, a[href])`;

/**
 * The sidebar as a macOS source list: one Tab stop (the open row, then the last one focused), ↑/↓, Home and End move
 * between visible rows. Shift and Alt arrows stay with the sidebar's own range selection and reordering.
 * DOM-level because rows come from several components; the tab order is re-applied whenever rows or the open row change.
 */
export function useSourceList(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Folded sections and other spaces' panels are inert.
    const rows = () =>
      [...root.querySelectorAll<HTMLElement>(ROW)].filter(
        (r) => !r.closest('[inert]'),
      );
    const rove = (current?: HTMLElement) => {
      const all = rows();
      const stop =
        current ??
        all.find((r) => r.tabIndex === 0 && 'roving' in r.dataset) ??
        all.find((r) => r.dataset.active === 'true') ??
        all[0];
      for (const r of all) {
        r.tabIndex = r === stop ? 0 : -1;
        r.dataset.roving = '';
      }
      for (const el of root.querySelectorAll<HTMLElement>(NESTED))
        el.tabIndex = -1;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const row = (e.target as Element).closest<HTMLElement>(ROW);
      if (!row || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      const all = rows();
      const next = all[nextRow(e.key, all.indexOf(row), all.length) ?? -1];
      if (!next) return;
      e.preventDefault();
      rove(next);
      next.focus();
    };
    const onFocusIn = (e: FocusEvent) => {
      const row = (e.target as Element).closest<HTMLElement>(ROW);
      if (row) rove(row);
    };
    rove();
    // Only structure, the open row and folding: watching tabindex would re-trigger on its own writes.
    const observer = new MutationObserver(() => rove());
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-active', 'inert'],
    });
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('focusin', onFocusIn);
    return () => {
      observer.disconnect();
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('focusin', onFocusIn);
    };
  }, [rootRef]);
}

/** The row a navigation key moves to from `at` among `count` rows, or undefined when the key isn't one or there's nowhere to go. */
export function nextRow(key: string, at: number, count: number) {
  if (count === 0) return;
  const target = {
    ArrowDown: at + 1,
    ArrowUp: at - 1,
    Home: 0,
    End: count - 1,
  }[key];
  if (target === undefined || target < 0 || target >= count) return;
  return target;
}
