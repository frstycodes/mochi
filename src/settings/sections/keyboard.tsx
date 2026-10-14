import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { COMMAND_GROUPS, COMMAND_IDS, COMMANDS, FIXED_KEYS, type CommandId } from '../../keymap';
import { useProfiles } from '../../profiles';
import { Shortcut } from '../../Shortcut';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup, SettingsRow } from '../parts';
import { getPrefs, setPrefs, usePrefs } from '../prefs';

/** Every keymap command with its chord, rebindable in place (`ShortcutRecorder`), then the keys that stay fixed. */
export function KeyboardSection() {
  const shown = shownCommands(useProfiles().length);
  const { keybindings } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3 px-3">
        <p className="type-meta text-muted-foreground">Click a shortcut to record a new one. Changes apply right away.</p>
        <Button variant="outline" size="sm" disabled={!Object.keys(keybindings).length} onClick={resetAll}>
          Reset all
        </Button>
      </div>
      {COMMAND_GROUPS.map((group) => (
        <SettingsGroup key={group} title={group}>
          {shown
            .filter((id) => COMMANDS[id].group === group)
            .map((id) => (
              <CatalogRow key={id} settingKey={`keybinding.${id}`} />
            ))}
        </SettingsGroup>
      ))}
      <SettingsGroup title="Fixed" footer="These belong to a field, a viewer or a gesture, so they can't be changed.">
        {FIXED_KEYS.map(({ keys, what }) => (
          <SettingsRow key={what} label={what} control={<Shortcut keys={keys} />} />
        ))}
      </SettingsGroup>
    </div>
  );
}

/** Profile shortcuts only for the profiles there are. */
export function shownCommands(profileCount: number): CommandId[] {
  return COMMAND_IDS.filter((id) => !id.startsWith('space-') || Number(id.slice('space-'.length)) <= profileCount);
}

export const shortcutRowId = (id: CommandId) => `shortcut-${id}`;

function resetAll() {
  const before = getPrefs().keybindings;
  setPrefs({ keybindings: {} });
  toast('Shortcuts reset to the defaults', { action: { label: 'Undo', onClick: () => setPrefs({ keybindings: before }) } });
}
