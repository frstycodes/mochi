import { IS_MAC } from '../keys';
import { isCommand, type Overrides } from '../keymap';
import { getPrefs } from '../settings/prefs';

export function menuNavDirection(
  e: KeyboardEvent,
  overrides: Overrides = getPrefs().keybindings,
  isMac = IS_MAC,
): 'next' | 'prev' | null {
  if (e.defaultPrevented || e.isComposing) return null;
  if (e.key === 'ArrowDown' || isCommand(e, 'menu-next', overrides, isMac))
    return 'next';
  if (e.key === 'ArrowUp' || isCommand(e, 'menu-previous', overrides, isMac))
    return 'prev';
  return null;
}

export function forwardMenuNav(
  e: KeyboardEvent,
  list: HTMLElement | null,
  overrides: Overrides = getPrefs().keybindings,
  isMac = IS_MAC,
): boolean {
  const dir = menuNavDirection(e, overrides, isMac);
  if (!dir) return false;
  list?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: dir === 'next' ? 'ArrowDown' : 'ArrowUp',
      bubbles: true,
    }),
  );
  return true;
}
