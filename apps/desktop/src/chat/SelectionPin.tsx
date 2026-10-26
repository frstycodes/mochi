import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Pin } from '@/icons';
import { Button } from '@/components/ui/button';
import { normalise, togglePin, type Pin as PinData } from './pins';

/** Select text inside one message and a Pin button appears above it; the passage is pinned to the outline rail. */
export function SelectionPin({
  threadId,
  scope,
}: {
  threadId: string;
  scope: RefObject<HTMLElement | null>;
}) {
  const [target, setTarget] = useState<{
    index: number;
    text: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const update = () => setTarget(readSelection(scope.current));
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [scope]);

  if (!target) return null;
  const pin = () => {
    togglePin(threadId, target.index, target.text);
    window.getSelection()?.removeAllRanges();
  };
  return createPortal(
    <Button
      size="sm"
      variant="secondary"
      onPointerDown={(e) => e.preventDefault()}
      onClick={pin}
      style={{ left: target.x, top: target.y }}
      className="fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+6px)] gap-1.5 rounded-full shadow-popover"
    >
      <Pin />
      Pin
    </Button>,
    document.body,
  );
}

/** A selection counts only when both ends sit in the same message, so a pin always belongs to one message. */
function readSelection(scope: HTMLElement | null) {
  const selection = window.getSelection();
  if (
    !scope ||
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount === 0
  )
    return null;
  const range = selection.getRangeAt(0);
  const owner = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      '[data-activity-index]',
    );
  const start = owner(range.startContainer);
  if (!start || start !== owner(range.endContainer) || !scope.contains(start))
    return null;
  const text = normalise(selection.toString());
  if (text.length < 2) return null;
  const rect = range.getBoundingClientRect();
  return {
    index: Number(start.dataset.activityIndex),
    text,
    x: rect.left + rect.width / 2,
    y: rect.top,
  };
}

/** Paints pinned passages with the CSS Custom Highlight API, so the message markup is never touched. */
export function usePinHighlights(
  scope: RefObject<HTMLElement | null>,
  pins: PinData[],
) {
  useEffect(() => {
    const el = scope.current;
    if (!el || typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const paint = () =>
      CSS.highlights.set(
        'harness-pin',
        new Highlight(...pins.flatMap((p) => (p.text ? findRange(el, p) : []))),
      );
    paint();
    // Messages render their markdown asynchronously; repaint when it lands.
    let frame = 0;
    const mo = new MutationObserver(
      () => (frame ||= requestAnimationFrame(() => ((frame = 0), paint()))),
    );
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
      CSS.highlights.delete('harness-pin');
    };
  }, [scope, pins]);
}

// GAP: matches a passage inside a single text node; one that spans formatting (bold, a link) stays pinned on the rail but isn't highlighted.
function findRange(scope: HTMLElement, pin: PinData): Range[] {
  const message = scope.querySelector(`[data-activity-index="${pin.index}"]`);
  if (!message) return [];
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? '').indexOf(pin.text);
    if (at < 0) continue;
    const range = new Range();
    range.setStart(node, at);
    range.setEnd(node, at + pin.text.length);
    return [range];
  }
  return [];
}
