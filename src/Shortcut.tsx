import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Command, createIcon, type IconComponent } from 'reicon-react';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { IS_MAC, keyName, orderKeys, shortcutText, type Key } from './keys';
import { bindingOf, type CommandId } from './keymap';
import { usePrefs } from './settings/prefs';

/** A keyboard shortcut as key caps: macOS modifiers as icons (⌘ ⇧ ⌥ ⌃), Windows and Linux as their printed names (Ctrl, Shift, Alt). */
export function Shortcut({ keys, className }: { keys: Key[]; className?: string }) {
  return (
    <KbdGroup aria-label={shortcutText(keys)} className={className}>
      {orderKeys(keys).map((key) => (
        <KeyCap key={key} name={key} />
      ))}
    </KbdGroup>
  );
}

/** A command's chord as it's bound now (Settings › Keyboard), live; nothing while it has none. */
export function BoundShortcut({ command, className }: { command: CommandId; className?: string }) {
  const keys = useBinding(command);
  return !!keys && <Shortcut keys={keys} className={className} />;
}

export function useBinding(command: CommandId | undefined) {
  const { keybindings } = usePrefs();
  return command ? bindingOf(command, keybindings) : null;
}

function KeyCap({ name }: { name: Key }) {
  const Icon = (IS_MAC && MAC_ICONS[name as keyof typeof MAC_ICONS]) || ARROW_ICONS[name as keyof typeof ARROW_ICONS];
  return <Kbd aria-hidden>{Icon ? <Icon /> : keyName(name)}</Kbd>;
}

// reicon ships Command but not the other macOS modifier glyphs; these are drawn on its 24px grid at its 1.5 stroke.
const ShiftKey = createIcon('ShiftKey', {
  O: `<path d="M12 3.75 3.75 12.25h4.5v7.5h7.5v-7.5h4.5L12 3.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
});
const OptionKey = createIcon('OptionKey', {
  O: `<path d="M3.75 6.75h4.5l7.5 10.5h4.5M14.25 6.75h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
});
const ControlKey = createIcon('ControlKey', {
  O: `<path d="m6.75 13.5 5.25-5.25 5.25 5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
});

const MAC_ICONS = { mod: Command, shift: ShiftKey, alt: OptionKey, nav: ControlKey } satisfies Record<string, IconComponent>;
const ARROW_ICONS = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight } satisfies Record<string, IconComponent>;
