import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useHarness } from '../store';
import { reviewThreads } from './order';

const ReviewModeContext = createContext<{ isOpen: boolean; open: () => void; close: () => void } | null>(null);

export function useReviewMode() {
  const ctx = useContext(ReviewModeContext);
  if (!ctx) throw new Error('useReviewMode must be used inside ReviewModeProvider');
  return ctx;
}

export function ReviewModeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo(() => ({ isOpen, open: () => setOpen(true), close: () => setOpen(false) }), [isOpen]);
  return <ReviewModeContext.Provider value={value}>{children}</ReviewModeContext.Provider>;
}

/** Sidebar entry: how many threads in the space wait on review, and whether review mode is showing them. */
export function useReviewEntry(spaceId: string) {
  const { state } = useHarness();
  const { isOpen, open } = useReviewMode();
  return { count: reviewThreads({ ...state, spaceId }).length, isOpen: isOpen && state.spaceId === spaceId, open };
}
