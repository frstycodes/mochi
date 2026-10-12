import { useEffect } from 'react';
import { isMod } from '../keys';
import { openSettings } from './open';

/** mod , opens settings, like every macOS app's Preferences. */
export function useSettingsShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.key !== ',') return;
      e.preventDefault();
      openSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
