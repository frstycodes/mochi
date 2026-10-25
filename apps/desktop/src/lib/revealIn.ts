/**
 * `scrollIntoView` confined to one scroller. The native call scrolls every scrolling ancestor too, the pinned and spaces pagers included:
 * a tab strip revealing its active tab as a swiped-in session mounted dragged the pager back to the old page and undid the swipe.
 */
export function revealIn(
  scroller: HTMLElement,
  el: Element,
  {
    align = 'nearest',
    behavior = 'instant',
  }: { align?: 'nearest' | 'start'; behavior?: ScrollBehavior } = {},
) {
  const box = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (align === 'start')
    return scroller.scrollBy({
      top:
        r.top -
        box.top -
        (parseFloat(getComputedStyle(el).scrollMarginTop) || 0),
      behavior,
    });
  const dx =
    r.left < box.left
      ? r.left - box.left
      : r.right > box.right
        ? r.right - box.right
        : 0;
  const dy =
    r.top < box.top
      ? r.top - box.top
      : r.bottom > box.bottom
        ? r.bottom - box.bottom
        : 0;
  if (dx || dy) scroller.scrollBy({ left: dx, top: dy, behavior });
}
