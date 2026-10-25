import { goHome, openReview, useIsReviewOpen } from '../routes/nav';
import { useHarnessSelector } from '../store';
import { reviewThreads } from './order';

/** `close` leaves review mode for the workspace, and does nothing when it isn't open: the palette and sidebar call it on every move. */
export function useReviewMode() {
  const isOpen = useIsReviewOpen();
  return { isOpen, open: openReview, close: () => isOpen && goHome() };
}

/** Sidebar entry: how many threads in the space wait on review, and whether review mode is showing them. */
export function useReviewEntry(spaceId: string) {
  const count = useHarnessSelector(
    (s) => reviewThreads({ ...s, spaceId }).length,
  );
  const isCurrent = useHarnessSelector((s) => s.spaceId === spaceId);
  const { isOpen, open } = useReviewMode();
  return { count, isOpen: isOpen && isCurrent, open };
}
