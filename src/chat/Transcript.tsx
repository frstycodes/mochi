import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import type { ChatRow } from './rows';

export interface TranscriptHandle {
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' }) => void;
}

export interface RememberedScroll {
  offset: number;
  isAtBottom: boolean;
  measurements: VirtualItem[];
}

/** Where each thread was left, so one that unmounted (opened elsewhere, a pinned page two swipes away) comes back there instead of at the bottom. */
export const rememberedScroll = new Map<string, RememberedScroll>();

// Close to a 2k-entry thread's measured mean, so first measurements barely move what's on screen.
const ROW_ESTIMATE_PX = 180;
// Matches the row column's `gap-5`.
const ROW_GAP_PX = 20;
// Matches the rows' `scroll-mt-6`: a jump leaves the row clear of the top edge.
const JUMP_PADDING_PX = 24;

/**
 * The chat's rows, virtualized: only the rows in view (plus a few each side) are mounted, measured as they render, so a thread with thousands
 * of entries mounts and scrolls like a short one. `use-stick-to-bottom` still owns following the stream: the list's height is the
 * virtualizer's total, and growing rows grow it.
 */
export function Transcript({ ref, threadId, rows, remembered, children }: { ref: Ref<TranscriptHandle>; threadId: string; rows: ChatRow[]; remembered: RememberedScroll | undefined; children: (row: ChatRow, index: number) => ReactNode }) {
  const { scrollRef, isAtBottom } = useStickToBottomContext();
  const list = useRef<HTMLDivElement>(null);
  const scrollMargin = useOffsetIn(list, scrollRef);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: (i) => rows[i].key,
    gap: ROW_GAP_PX,
    overscan: 4,
    scrollMargin,
    scrollPaddingStart: JUMP_PADDING_PX,
    // Past the end clamps to the bottom: a thread opens on its latest rows without mounting the first ones for a frame.
    initialOffset: () => (remembered && !remembered.isAtBottom ? remembered.offset : rows.length * (ROW_ESTIMATE_PX + ROW_GAP_PX)),
    initialMeasurementsCache: remembered?.measurements,
  });
  useImperativeHandle(ref, () => ({ scrollToIndex: (index, options) => virtualizer.scrollToIndex(index, options) }), [virtualizer]);
  useRememberScroll(threadId, virtualizer, isAtBottom);
  useRevealCard(rows, virtualizer);

  const items = virtualizer.getVirtualItems();
  const top = (items[0]?.start ?? scrollMargin) - scrollMargin;
  return (
    <div ref={list} className="relative w-full shrink-0" style={{ height: virtualizer.getTotalSize() }}>
      <div className="absolute inset-x-0 top-0 flex flex-col gap-5" style={{ translate: `0 ${top}px` }}>
        {items.map((item) => (
          <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} data-chat-row={item.index}>
            {children(rows[item.index], item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

type Virtualizer = ReturnType<typeof useVirtualizer<HTMLElement, Element>>;

/** The list's distance from the top of the scroller's content (the chat's top padding): the virtualizer's `scrollMargin`. */
function useOffsetIn(list: RefObject<HTMLElement | null>, scrollRef: RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const el = list.current;
    const scroller = scrollRef.current;
    if (el && scroller) setOffset(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
  }, [list, scrollRef]);
  return offset;
}

function useRememberScroll(threadId: string, virtualizer: Virtualizer, isAtBottom: boolean) {
  const latest = useRef({ virtualizer, isAtBottom });
  latest.current = { virtualizer, isAtBottom };
  useEffect(
    () => () => {
      const { virtualizer: v, isAtBottom: atBottom } = latest.current;
      rememberedScroll.set(threadId, { offset: v.scrollOffset ?? 0, isAtBottom: atBottom, measurements: v.takeSnapshot() });
    },
    [threadId],
  );
}

const REVEAL_CARD = 'chat-reveal-card';

/** Scrolls the mounted transcript that holds Mochi widget `cardId` to it, mounting its row; `useShowCard` then focuses it. */
export function revealCard(cardId: string) {
  window.dispatchEvent(new CustomEvent(REVEAL_CARD, { detail: cardId }));
}

function useRevealCard(rows: ChatRow[], virtualizer: Virtualizer) {
  useEffect(() => {
    const onReveal = (e: Event) => {
      const i = rows.findIndex((r) => r.kind === 'event' && r.entry.card?.id === (e as CustomEvent<string>).detail);
      if (i >= 0) virtualizer.scrollToIndex(i, { align: 'center' });
    };
    window.addEventListener(REVEAL_CARD, onReveal);
    return () => window.removeEventListener(REVEAL_CARD, onReveal);
  }, [rows, virtualizer]);
}
