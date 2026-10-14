import { useEffect } from 'react';
import { commandOf, spaceCommand } from '../keymap';
import { getProfiles } from '../profiles';
import { useHarness } from '../store';

const SPACES = Array.from({ length: 9 }, (_, i) => spaceCommand(i + 1));

/** The palette, a profile by position, and New thread (`src/keymap.ts`). */
export function useGlobalKeys(onPalette: () => void) {
  const { dispatch } = useHarness();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = commandOf(e, ['palette', 'go-new', ...SPACES]);
      if (!command) return;
      if (command === 'palette') return (e.preventDefault(), onPalette());
      if (command === 'go-new') return (e.preventDefault(), dispatch({ type: 'go', view: { kind: 'new' } }));
      const profile = getProfiles()[SPACES.indexOf(command)];
      if (!profile) return;
      e.preventDefault();
      dispatch({ type: 'space', id: profile.id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, onPalette]);
}
