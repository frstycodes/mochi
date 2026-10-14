import { useEffect } from 'react';
import { isCommand } from '../keymap';
import { openSettings } from './open';

/** Settings' command (mod , by default, like every macOS app's Preferences). */
export function useSettingsShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isCommand(e, 'go-settings')) return;
      e.preventDefault();
      openSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
