import { useEffect, useRef } from 'react';
import { useHarness } from '../store';
import { isMod } from '../keys';
import { pinnedNeighbour, slotsOf } from './slots';

/**
 * mod Shift [ / ] steps to the previous or next pinned thread, instantly: macOS's own previous/next tab keys (⌃←/→ belongs to Mission Control
 * and never reaches the app). Digits and brackets use `e.code`, so they work on any layout. mod ↑ toggles the overview, Esc closes it.
 */
export function usePagerKeys() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = latest.current;
      if (isMod(e) && !e.shiftKey && !e.altKey && e.key === 'ArrowUp' && !isEditingText(e.target)) {
        e.preventDefault();
        return dispatch({ type: 'overview-toggle' });
      }
      if (e.key === 'Escape' && s.isOverview) {
        e.preventDefault();
        return dispatch({ type: 'overview-toggle', isOpen: false });
      }
      if (!isMod(e) || !e.shiftKey || e.altKey || (e.code !== 'BracketLeft' && e.code !== 'BracketRight')) return;
      const id = pinnedNeighbour(slotsOf(s), e.code === 'BracketLeft' ? -1 : 1);
      if (!id) return;
      e.preventDefault();
      dispatch({ type: 'go', view: { kind: 'thread', id } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}

/** mod ↑ moves the caret in a field with text; an empty composer (which holds focus most of the time) lets it through. */
function isEditingText(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value.length > 0;
  return target instanceof HTMLElement && target.isContentEditable && !!target.textContent;
}
