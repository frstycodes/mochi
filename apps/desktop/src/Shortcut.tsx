import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Command,
  Control,
  Option,
  Return,
  Shift,
  type IconComponent,
} from '@/icons';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { IS_MAC, keyName, orderKeys, shortcutText, type Key } from './keys';
import { bindingOf, type CommandId } from './keymap';
import { usePrefs } from './settings/prefs';

/** A keyboard shortcut as key caps: macOS modifiers as icons (⌘ ⇧ ⌥ ⌃), Windows and Linux as their printed names (Ctrl, Shift, Alt). */
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
  const Icon =
    (IS_MAC && MAC_ICONS[name as keyof typeof MAC_ICONS]) ||
    ARROW_ICONS[name as keyof typeof ARROW_ICONS];
  return <Kbd aria-hidden>{Icon ? <Icon /> : keyName(name)}</Kbd>;
}

const MAC_ICONS = {
  mod: Command,
  shift: Shift,
  alt: Option,
  nav: Control,
  Enter: Return,
} satisfies Record<string, IconComponent>;
const ARROW_ICONS = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
} satisfies Record<string, IconComponent>;
