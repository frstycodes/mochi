import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ErrorFallback } from '@/components/ErrorFallback';
import type { ChatRow } from './rows';
import { hasGaps, transcriptGaps } from './transcriptGaps';

export interface TranscriptHandle {
  scrollToIndex: (
    index: number,
    options?: { align?: 'start' | 'center' | 'end' },
  ) => void;
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
export function Transcript({
  ref,
  threadId,
  rows,
  remembered,
  children,
}: {
  ref: Ref<TranscriptHandle>;
  threadId: string;
  rows: ChatRow[];
  remembered: RememberedScroll | undefined;
  children: (row: ChatRow, index: number) => ReactNode;
}) {
  const { scrollRef, contentRef, isAtBottom } = useStickToBottomContext();
  const list = useRef<HTMLDivElement>(null);
  const scrollMargin = useOffsetIn(list, scrollRef, contentRef);
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
    initialOffset: () =>
      remembered && !remembered.isAtBottom
        ? remembered.offset
        : rows.length * (ROW_ESTIMATE_PX + ROW_GAP_PX),
    initialMeasurementsCache: remembered?.measurements,
  });
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, options) =>
        virtualizer.scrollToIndex(index, options),
    }),
    [virtualizer],
  );
  useSyncScrollOffset(scrollRef, virtualizer);
  useRememberScroll(threadId, virtualizer, isAtBottom);
  useRevealCard(rows, virtualizer);
  useGapCheck(list, scrollRef, contentRef, virtualizer);

  const items = virtualizer.getVirtualItems();
  const top = (items[0]?.start ?? scrollMargin) - scrollMargin;
  return (
    <div
      ref={list}
      className="relative w-full shrink-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      <div
        className="absolute inset-x-0 top-0 flex flex-col gap-5"
        style={{ translate: `0 ${top}px` }}
      >
        {items.map((item) => (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            data-chat-row={item.index}
          >
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              {children(rows[item.index], item.index)}
            </ErrorBoundary>
          </div>
        ))}
      </div>
    </div>
  );
}

type Virtualizer = ReturnType<typeof useVirtualizer<HTMLElement, Element>>;

/** The list's distance from the top of the scroller's content (the chat's top padding and setup row above it): the virtualizer's `scrollMargin`. */
function useOffsetIn(
  list: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
) {
  const [offset, setOffset] = useState(0);
  // Not a layout effect: the scroller and content are ancestors, and React attaches their refs after this child's layout effects run.
  useEffect(() => {
    const el = list.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!el || !scroller || !content) return;
    const measure = () =>
      setOffset(
        el.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    measure();
    // Anything above the list growing or folding resizes the content box. Not the list's parent: ChatView wraps the rows in a
    // `display: contents` div, which has no box, so a ResizeObserver on it never fires and a stale margin opens a gap above the rows.
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [list, scrollRef, contentRef]);
  return offset;
}

/**
 * The virtualizer learns the scroller's offset only from scroll events, and `initialOffset` guesses the bottom. A thread whose rows fit
 * the viewport never scrolls, so no event corrects the guess and only its last rows mount, leaving the top of the chat empty. The
 * virtualizer attaches on the render after `scrollMargin` is measured (the scroller is an ancestor, so its ref is unset on the first
 * render); replay a scroll when the two disagree so it reads the real offset.
 */
function useSyncScrollOffset(
  scrollRef: RefObject<HTMLElement | null>,
  virtualizer: Virtualizer,
) {
  // Every render: the attach happens in a render nothing else marks.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || virtualizer.scrollElement !== scroller) return;
    if (scroller.scrollTop === virtualizer.scrollOffset) return;
    scroller.dispatchEvent(new Event('scroll'));
  });
}

const GAP_CHECK_SETTLE_MS = 250;

/** Dev only: once scrolling and resizing settle, reports any part of the visible list the mounted rows don't cover, with how far rows sit from where the virtualizer placed them. */
function useGapCheck(
  list: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  virtualizer: Virtualizer,
) {
  const rowStarts = useEffectEvent(
    () =>
      new Map(
        virtualizer.getVirtualItems().map((item) => [item.index, item.start]),
      ),
  );
  useEffect(() => {
    const el = list.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!import.meta.env.DEV || !el || !scroller || !content) return;
    let timer = 0;
    const check = () => {
      // An off-screen pinned page skips layout; measuring it would force it.
      if (!el.checkVisibility({ contentVisibilityAuto: true })) return;
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const span = (box: DOMRect) => ({
        top: box.top - origin,
        bottom: box.bottom - origin,
      });
      const rendered = [...el.querySelectorAll<HTMLElement>('[data-chat-row]')];
      const starts = rowStarts();
      const listBox = span(el.getBoundingClientRect());
      const view = {
        top: Math.max(listBox.top, scroller.scrollTop),
        bottom: Math.min(
          listBox.bottom,
          scroller.scrollTop + scroller.clientHeight,
        ),
      };
      const gaps = transcriptGaps(
        rendered.map((row) => span(row.getBoundingClientRect())),
        rendered.map((row) => starts.get(Number(row.dataset.index)) ?? NaN),
        view,
        ROW_GAP_PX,
      );
      if (hasGaps(gaps)) console.error('Transcript window has gaps', gaps);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, GAP_CHECK_SETTLE_MS);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(content);
    ro.observe(scroller);
    scroller.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      scroller.removeEventListener('scroll', schedule);
    };
  }, [list, scrollRef, contentRef]);
}

function useRememberScroll(
  threadId: string,
  virtualizer: Virtualizer,
  isAtBottom: boolean,
) {
  const remember = useEffectEvent((id: string) => {
    rememberedScroll.set(id, {
      offset: virtualizer.scrollOffset ?? 0,
      isAtBottom,
      measurements: virtualizer.takeSnapshot(),
    });
  });
  useEffect(() => () => remember(threadId), [threadId]);
}

const REVEAL_CARD = 'chat-reveal-card';

/** Scrolls the mounted transcript that holds Mochi widget `cardId` to it, mounting its row; `useShowCard` then focuses it. */
export function revealCard(cardId: string) {
  window.dispatchEvent(new CustomEvent(REVEAL_CARD, { detail: cardId }));
}

function useRevealCard(rows: ChatRow[], virtualizer: Virtualizer) {
  useEffect(() => {
    const onReveal = (e: Event) => {
      const i = rows.findIndex(
        (r) =>
          r.kind === 'event' &&
          r.entry.card?.id === (e as CustomEvent<string>).detail,
      );
      if (i >= 0) virtualizer.scrollToIndex(i, { align: 'center' });
    };
    window.addEventListener(REVEAL_CARD, onReveal);
    return () => window.removeEventListener(REVEAL_CARD, onReveal);
  }, [rows, virtualizer]);
}
