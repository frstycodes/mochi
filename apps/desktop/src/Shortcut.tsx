import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { IS_MAC, keyName, orderKeys, shortcutText, type Key } from './keys';
import { bindingOf, type CommandId } from './keymap';
import { usePrefs } from './settings/prefs';

/** A keyboard shortcut as key caps: macOS modifiers as their symbols (⌘ ⇧ ⌥ ⌃), Windows and Linux as their printed names (Ctrl, Shift, Alt). */
export function Shortcut({
  keys,
  className,
}: {
  keys: Key[];
  className?: string;
}) {
  return (
    <KbdGroup aria-label={shortcutText(keys)} className={className}>
      {orderKeys(keys).map((key) => (
        <KeyCap key={key} name={key} />
      ))}
    </KbdGroup>
  );
}

/** A command's chord as it's bound now (Settings › Keyboard), live; nothing while it has none. */
export function BoundShortcut({
  command,
  className,
}: {
  command: CommandId;
  className?: string;
}) {
  const keys = useBinding(command);
  return !!keys && <Shortcut keys={keys} className={className} />;
}

export function useBinding(command: CommandId | undefined) {
  const { keybindings } = usePrefs();
  return command ? bindingOf(command, keybindings) : null;
}

function KeyCap({ name }: { name: Key }) {
  const symbol =
    (IS_MAC && MAC_SYMBOLS[name as keyof typeof MAC_SYMBOLS]) ||
    ARROW_SYMBOLS[name as keyof typeof ARROW_SYMBOLS];
  return <Kbd aria-hidden>{symbol || keyName(name)}</Kbd>;
}

const MAC_SYMBOLS = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  nav: '⌃',
  Enter: '↩',
} satisfies Partial<Record<Key, string>>;
const ARROW_SYMBOLS = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
} satisfies Partial<Record<Key, string>>;
