import { useEffect, useRef } from 'react';
import { useHarness } from '../store';

/**
 * Cmd Shift S toggles Stage Manager, Cmd ↑ toggles the overview, Esc closes it. In Stage Manager Ctrl ←/→ (↑/↓ in portrait) steps one card,
 * instantly; the split keys run first, so inside a split group Ctrl arrows still move between splits and only step the stage at the group's edge.
 */
export function useStageKeys(onStep: (step: 1 | -1) => void) {
  const { state, dispatch } = useHarness();
  const latest = useRef({ state, onStep });
  latest.current = { state, onStep };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const { state: s, onStep: step } = latest.current;
      if (e.metaKey && e.shiftKey && !e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        return dispatch({ type: 'stage-toggle' });
      }
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key === 'ArrowUp' && !isEditingText(e.target)) {
        e.preventDefault();
        return dispatch({ type: 'overview-toggle' });
      }
      if (e.key === 'Escape' && s.isOverview) {
        e.preventDefault();
        return dispatch({ type: 'overview-toggle', isOpen: false });
      }
      if (!s.isStage || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const keys = s.orientation === 'column' ? (['ArrowUp', 'ArrowDown'] as const) : (['ArrowLeft', 'ArrowRight'] as const);
      const dir = keys.indexOf(e.key as never);
      if (dir < 0) return;
      e.preventDefault();
      step(dir === 0 ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}

/** Cmd ↑ moves the caret in a field with text; an empty composer (which holds focus most of the time) lets it through. */
function isEditingText(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value.length > 0;
  return target instanceof HTMLElement && target.isContentEditable && !!target.textContent;
}
