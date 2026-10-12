import { useEffect } from 'react';
import { SPACES } from '../model';
import { useHarness } from '../store';
import { isMod, isNav } from '../keys';

/** mod K toggles the palette, nav 1–3 switches space, N starts a new thread (`src/keys.ts`). */
export function useGlobalKeys(onPalette: () => void) {
  const { dispatch } = useHarness();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMod(e) && e.key === 'k') {
        e.preventDefault();
        onPalette();
        return;
      }
      if (isNav(e) && /^Digit[1-3]$/.test(e.code)) {
        e.preventDefault();
        dispatch({ type: 'space', id: SPACES[Number(e.code.slice(5)) - 1].id });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [role=dialog]')) return;
      if (e.key === 'n') {
        e.preventDefault();
        dispatch({ type: 'go', view: { kind: 'new' } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, onPalette]);
}
