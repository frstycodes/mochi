import { useEffect } from 'react';
import { isCommand, listenKeydown } from '../keymap';
import { openSettings } from '../routes/nav';

/** Settings' command (mod , by default, like every macOS app's Preferences). */
export function useSettingsShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isCommand(e, 'go-settings')) return;
      e.preventDefault();
      openSettings();
    };
    return listenKeydown(onKey);
  }, []);
}
