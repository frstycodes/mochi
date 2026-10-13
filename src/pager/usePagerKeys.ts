import { useEffect, useRef } from 'react';
import { useHarness } from '../store';
import { isMod, isNav } from '../keys';
import { pinnedNeighbour, slotsOf } from './slots';

/**
 * nav ←/→ steps to the previous or next pinned thread, instantly; the split keys run first, so inside a split group the arrows move between
 * splits and only step at the group's edge. mod ↑ toggles the overview, Esc closes it.
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
      if (!isNav(e) || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const id = pinnedNeighbour(slotsOf(s), e.key === 'ArrowLeft' ? -1 : 1);
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
