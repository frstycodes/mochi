import {
  createContext,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { LegendList, type LegendListRef } from '@legendapp/list/react';
import { ErrorFallback } from '@/components/ErrorFallback';
import { Button } from '@/components/ui/button';
import { ArrowDown } from '@/icons';
import { cn } from '@/lib/utils';
import type { ChatRow } from './rows';

export interface RememberedScroll {
  /** The row at the top of the view and how far the view's top sat below the row's top. */
  anchor: { key: string; offset: number } | undefined;
  isAtEnd: boolean;
}

/** Where each thread was left, so one that unmounted (opened elsewhere, a pinned page two swipes away) comes back there instead of at the bottom. */
export const rememberedScroll = new Map<string, RememberedScroll>();

// Close to a 2k-entry thread's measured mean, so first measurements barely move what's on screen.
const ROW_ESTIMATE_PX = 180;

/**
 * The chat's scroller and its rows, virtualized by LegendList: only the rows near the view mount, measured as they render. The list alone
 * moves the scroll position: it follows the stream at the end, holds the rows in view still when rows above them change size, and lets go
 * of the end when the reader scrolls up. `header` and `footer` scroll with the rows and are never virtualized.
 */
export function Transcript({
  threadId,
  rows,
  remembered,
  header,
  footer,
  renderRow,
  className,
  children,
}: {
  threadId: string;
  rows: ChatRow[];
  remembered: RememberedScroll | undefined;
  header: ReactElement;
  footer: ReactElement;
  renderRow: (row: ChatRow, index: number) => ReactNode;
  className?: string;
  /** Drawn over the scroller, with `useTranscript` available. */
  children?: ReactNode;
}) {
  const list = useRef<LegendListRef>(null);
  // The list's handle, once mounted: set in the list's own layout effects, which run before this one.
  const [mounted, setMounted] = useState<LegendListRef | null>(null);
  useLayoutEffect(() => setMounted(list.current), []);
  const scroller = mounted?.getScrollableNode() ?? null;
  const isAtEnd = useIsAtEnd(mounted);
  useRememberScroll(threadId, list);
  useRevealCard(rows, list);
  useRevealMessage(threadId, rows, list);
  const [initialIndex] = useState(() => restoredIndex(rows, remembered));

  return (
    <TranscriptContext
      value={{
        scroller,
        isAtEnd,
        // Not animated: an animated run across thousands of unmeasured rows retargets as they measure and can stop short of the end.
        scrollToEnd: () => void list.current?.scrollToEnd({ animated: false }),
      }}
    >
      <LegendList<ChatRow>
        ref={list}
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        // The rows read the chat's live state through `renderRow`, not through `rows`: a new one redraws the mounted rows.
        extraData={renderRow}
        // The gutter is on each row: the list places rows absolutely across the content box, so the box's own padding wouldn't apply.
        // The space under a row is its own padding, not `columnWrapperStyle.rowGap`: the list's content size drops the last row's gap
        // while the footer still sits below it, so the list's end would stop 20px short of the scroller's and re-pinning would bounce the rows.
        renderItem={({ item, index }) => (
          // A row with nothing to show (an earlier turn's widgets all answered) keeps no gap, or it would double the space around it.
          <div data-chat-row={index} className="px-4 pb-5 empty:pb-0 md:px-6">
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              {renderRow(item, index)}
            </ErrorBoundary>
          </div>
        )}
        estimatedItemSize={ROW_ESTIMATE_PX}
        initialScrollAtEnd={initialIndex === undefined}
        {...(initialIndex && { initialScrollIndex: initialIndex })}
        maintainScrollAtEnd={{ animated: false }}
        maintainVisibleContentPosition
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        // The browser's own scroll anchoring would correct the same size changes the list already corrects.
        className={cn('h-full [overflow-anchor:none]', className)}
        contentContainerClassName="mx-auto w-full max-w-(--chat-width)"
        role="log"
      />
      {children}
    </TranscriptContext>
  );
}

interface TranscriptView {
  /** The scroll element, once the list has mounted it. */
  scroller: HTMLElement | null;
  isAtEnd: boolean;
  scrollToEnd: () => void;
}

const TranscriptContext = createContext<TranscriptView | null>(null);

export function useTranscript() {
  const view = use(TranscriptContext);
  if (!view) throw new Error('useTranscript outside a Transcript');
  return view;
}

function useIsAtEnd(list: LegendListRef | null) {
  return useSyncExternalStore(
    (onChange) => list?.getState().listen('isAtEnd', onChange) ?? (() => {}),
    () => list?.getState().isAtEnd ?? true,
  );
}

/** The reopened thread's first row and offset, or undefined to open at the end. */
export function restoredIndex(
  rows: ChatRow[],
  remembered: RememberedScroll | undefined,
) {
  const anchor = remembered?.anchor;
  if (!anchor || remembered.isAtEnd) return undefined;
  const index = rows.findIndex((r) => r.key === anchor.key);
  return index < 0 ? undefined : { index, viewOffset: -anchor.offset };
}

function useRememberScroll(
  threadId: string,
  list: RefObject<LegendListRef | null>,
) {
  // A layout effect: its cleanup runs before the list's own handle is torn down.
  useLayoutEffect(
    () => () => {
      const current = list.current;
      if (!current) return;
      rememberedScroll.set(threadId, {
        anchor: current.anchorVisibleContent({ hold: false }),
        isAtEnd: current.getState().isAtEnd,
      });
    },
    [threadId, list],
  );
}

const REVEAL_CARD = 'chat-reveal-card';

/** Scrolls the mounted transcript that holds Mochi widget `cardId` to it, mounting its row; `useShowCard` then focuses it. */
export function revealCard(cardId: string) {
  window.dispatchEvent(new CustomEvent(REVEAL_CARD, { detail: cardId }));
}

function useRevealCard(rows: ChatRow[], list: RefObject<LegendListRef | null>) {
  useEffect(() => {
    const onReveal = (e: Event) => {
      const index = rows.findIndex(
        (r) =>
          r.kind === 'event' &&
          r.entry.card?.id === (e as CustomEvent<string>).detail,
      );
      if (index >= 0)
        void list.current?.scrollToIndex({ index, viewPosition: 0.5 });
    };
    window.addEventListener(REVEAL_CARD, onReveal);
    return () => window.removeEventListener(REVEAL_CARD, onReveal);
  }, [rows, list]);
}

const REVEAL_MESSAGE = 'chat-reveal-message';
let pendingReveal: { threadId: string; index: number } | undefined;

/** Scrolls thread `threadId`'s transcript to the message at activity `index`, now or once that thread's transcript mounts. */
export function revealMessage(threadId: string, index: number) {
  pendingReveal = { threadId, index };
  window.dispatchEvent(new Event(REVEAL_MESSAGE));
}

function useRevealMessage(
  threadId: string,
  rows: ChatRow[],
  list: RefObject<LegendListRef | null>,
) {
  useEffect(() => {
    const reveal = () => {
      if (pendingReveal?.threadId !== threadId) return;
      const { index } = pendingReveal;
      const row = rows.findIndex(
        (r) => r.kind === 'message' && r.index === index,
      );
      if (row < 0) return;
      pendingReveal = undefined;
      void list.current?.scrollToIndex({ index: row, viewPosition: 0.2 });
    };
    reveal();
    window.addEventListener(REVEAL_MESSAGE, reveal);
    return () => window.removeEventListener(REVEAL_MESSAGE, reveal);
  }, [threadId, rows, list]);
}

/** Back to the newest message, shown once the reader has left the end. */
export function TranscriptScrollButton({ className }: { className?: string }) {
  const { isAtEnd, scrollToEnd } = useTranscript();
  return (
    !isAtEnd && (
      <Button
        aria-label="Scroll to the newest message"
        className={cn(
          'absolute left-1/2 -translate-x-1/2 dark:bg-background dark:hover:bg-muted',
          className,
        )}
        onClick={scrollToEnd}
        size="icon"
        type="button"
        variant="outline"
      >
        <ArrowDown className="size-4" aria-hidden />
      </Button>
    )
  );
}
