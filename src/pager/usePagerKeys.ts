import { useEffect, useRef } from 'react';
import { useHarness } from '../store';
import { commandOf, listenKeydown, isCommand } from '../keymap';
import { pinnedNeighbour, slotsOf } from './slots';

/**
 * Previous / next pinned thread, instantly (mod Shift [ / ] by default: macOS's own previous/next tab keys, since ⌃←/→ belongs to
 * Mission Control and never reaches the app). Show all sessions toggles the overview, Esc closes it.
 */
export function usePagerKeys() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = latest.current;
      if (isCommand(e, 'dismiss') && s.isOverview) {
        e.preventDefault();
        return dispatch({ type: 'overview-toggle', isOpen: false });
      }
      const command = commandOf(e, ['layout-overview', 'pinned-previous', 'pinned-next']);
      if (!command) return;
      if (command === 'layout-overview') {
        if (isEditingText(e.target)) return;
        e.preventDefault();
        return dispatch({ type: 'overview-toggle' });
      }
      const id = pinnedNeighbour(slotsOf(s), command === 'pinned-previous' ? -1 : 1);
      if (!id) return;
      e.preventDefault();
      dispatch({ type: 'go', view: { kind: 'thread', id } });
    };
    return listenKeydown(onKey);
  }, [dispatch]);
}

/** Show all sessions' default, mod ↑, moves the caret in a field with text; an empty composer (which holds focus most of the time) lets it through. */
function isEditingText(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value.length > 0;
  return target instanceof HTMLElement && target.isContentEditable && !!target.textContent;
}
