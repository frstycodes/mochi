import { useState } from 'react';
import { CloseCircle, Keyboard, SearchNormal } from 'reicon-react';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { COMMAND_GROUPS, COMMAND_IDS, COMMANDS, filterCommands, FIXED_KEYS, isCustom, type CommandId, type ShortcutFilter } from '../../keymap';
import { useProfiles } from '../../profiles';
import { Shortcut } from '../../Shortcut';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup, SettingsRow, SettingsSection } from '../parts';
import { useRecording } from '../ShortcutRecorder';
import { getPrefs, setPrefs, usePrefs } from '../prefs';

/** Every keymap command with its chord, rebindable in place (`ShortcutRecorder`), then the keys that stay fixed. */
export function KeyboardSection() {
  const shown = shownCommands(useProfiles().length);
  const { keybindings } = usePrefs();
  const [filter, setFilter] = useState<ShortcutFilter>({ query: '', chord: null, isChangedOnly: false });
  const [isListening, setListening] = useState(false);
  useRecording(isListening, {
    onCancel: () => setListening(false),
    onClear: () => (setFilter((f) => ({ ...f, chord: null })), setListening(false)),
    onChord: (chord) => (setFilter((f) => ({ ...f, chord, query: '' })), setListening(false)),
  });
  const commands = filterCommands(shown, filter, keybindings);
  const q = filter.query.trim().toLowerCase();
  // Fixed keys can't be rebound, so a chord or Changed filter never finds them.
  const fixed = filter.chord || filter.isChangedOnly ? [] : FIXED_KEYS.filter(({ what }) => !q || what.toLowerCase().includes(q));
  const changedCount = shown.filter((id) => isCustom(id, keybindings)).length;
  const isEmpty = !commands.length && !fixed.length;
  return (
    <div className="flex flex-col gap-10">
      <SettingsSection footer="Click a shortcut to record a new one. Changes apply right away.">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-56 flex-1">
            <InputGroupAddon>
              <SearchNormal />
            </InputGroupAddon>
            {filter.chord ? (
              <span className="flex flex-1 items-center gap-1.5 px-1.5 type-body">
                <span className="text-muted-foreground">Shortcut</span>
                <Shortcut keys={filter.chord} />
              </span>
            ) : (
              <InputGroupInput value={filter.query} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} placeholder={isListening ? 'Press a shortcut…' : 'Filter shortcuts'} aria-label="Filter shortcuts" />
            )}
            <InputGroupAddon align="inline-end">
              {filter.chord ? (
                <InputGroupButton aria-label="Clear the shortcut" onClick={() => setFilter((f) => ({ ...f, chord: null }))}>
                  <CloseCircle />
                </InputGroupButton>
              ) : (
                <InputGroupButton aria-pressed={isListening} onClick={() => setListening((on) => !on)}>
                  <Keyboard />
                  {isListening ? 'Listening' : 'Find by keys'}
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
          <Toggle variant="outline" size="sm" pressed={filter.isChangedOnly} onPressedChange={(isChangedOnly) => setFilter((f) => ({ ...f, isChangedOnly }))} disabled={!changedCount && !filter.isChangedOnly}>
            Changed
            {changedCount > 0 && <span className="text-muted-foreground tabular">{changedCount}</span>}
          </Toggle>
          <Button variant="outline" size="sm" disabled={!changedCount} onClick={resetAll}>
            Reset all
          </Button>
        </div>
      </SettingsSection>
      {COMMAND_GROUPS.map((group) => {
        const ids = commands.filter((id) => COMMANDS[id].group === group);
        return (
          ids.length > 0 && (
            <SettingsGroup key={group} title={group}>
              {ids.map((id) => (
                <CatalogRow key={id} settingKey={`keybinding.${id}`} />
              ))}
            </SettingsGroup>
          )
        );
      })}
      {fixed.length > 0 && (
        <SettingsGroup title="Fixed" footer="These belong to a field, a viewer or a gesture, so they can't be changed.">
          {fixed.map(({ keys, what }) => (
            <SettingsRow key={what} label={what} control={<Shortcut keys={keys} />} />
          ))}
        </SettingsGroup>
      )}
      {isEmpty && <NoShortcutMatch filter={filter} />}
    </div>
  );
}

function NoShortcutMatch({ filter }: { filter: ShortcutFilter }) {
  return (
    <p className="flex flex-wrap items-center gap-1 px-1 type-meta text-muted-foreground">
      {filter.chord ? (
        <>
          Nothing uses <Shortcut keys={filter.chord} /> yet, so it's free to give a command.
        </>
      ) : (
        `No shortcut matches “${filter.query.trim()}”.`
      )}
    </p>
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
