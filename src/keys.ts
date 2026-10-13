/**
 * Keyboard shortcuts across platforms. `mod` is the primary modifier (⌘ on macOS, Ctrl on Windows and Linux);
 * `nav` is the secondary one for moving between spaces, splits and pinned threads (⌃ on macOS, Alt elsewhere, because Ctrl is `mod` there).
 */
export type Modifier = 'mod' | 'nav' | 'shift' | 'alt';
export type Arrow = 'up' | 'down' | 'left' | 'right';
export type Key = Modifier | Arrow | (string & {});

interface ModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export const IS_MAC = typeof navigator !== 'undefined' && isMacPlatform((navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform);

/** Chromium's `userAgentData.platform` says `macOS`, the older `navigator.platform` says `MacIntel`: match both, any case. */
export function isMacPlatform(platform: string) {
  return /mac|iphone|ipad/i.test(platform);
}

export function isMod(e: ModifierState, isMac = IS_MAC) {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Only the secondary modifier, so `nav` shortcuts never fire alongside `mod` ones. */
export function isNav(e: ModifierState, isMac = IS_MAC) {
  return isMac ? e.ctrlKey && !e.metaKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey;
}

/** `KeyboardEvent.key` of the modifier the composer holds to queue a message: never the Windows key, which opens Start. */
export const MOD_KEY = IS_MAC ? 'Meta' : 'Control';

const MAC_ORDER: Key[] = ['nav', 'alt', 'shift', 'mod'];
const PC_ORDER: Key[] = ['mod', 'nav', 'alt', 'shift'];

/** Modifiers in the platform's conventional order (⌃⌥⇧⌘ on macOS, Ctrl+Alt+Shift elsewhere), then the key. */
export function orderKeys(keys: Key[], isMac = IS_MAC) {
  const order = isMac ? MAC_ORDER : PC_ORDER;
  const rank = (k: Key) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

const NAMES: Record<Modifier | Arrow, [mac: string, pc: string]> = {
  mod: ['Command', 'Ctrl'],
  nav: ['Control', 'Alt'],
  shift: ['Shift', 'Shift'],
  alt: ['Option', 'Alt'],
  up: ['Up arrow', 'Up arrow'],
  down: ['Down arrow', 'Down arrow'],
  left: ['Left arrow', 'Left arrow'],
  right: ['Right arrow', 'Right arrow'],
};

/** What a key is called on this platform: the visible text where no icon is drawn, and the accessible name where one is. */
export function keyName(key: Key, isMac = IS_MAC) {
  const names = NAMES[key as Modifier | Arrow];
  return names ? names[isMac ? 0 : 1] : key;
}

/** One-line form for tooltips and `aria-keyshortcuts`-style text: `Shift Command S` / `Ctrl+Shift+S`. */
export function shortcutText(keys: Key[], isMac = IS_MAC) {
  return orderKeys(keys, isMac)
    .map((k) => keyName(k, isMac))
    .join(isMac ? ' ' : '+');
}
