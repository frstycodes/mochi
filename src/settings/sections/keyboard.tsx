import { ACTION_GROUPS, ACTIONS, type PaletteAction } from '../../palette/actions';
import { Shortcut } from '../../Shortcut';
import { SettingsGroup, SettingsRow } from '../parts';

/** Read-only: every palette action with a shortcut, in the palette's groups. Rebinding comes later (SETTINGS.md). */
export function KeyboardSection() {
  return (
    <div className="flex flex-col gap-8">
      {ACTION_GROUPS.map((group) => {
        const actions = SHORTCUTS.filter((a) => a.group === group);
        if (!actions.length) return null;
        return (
          <SettingsGroup key={group} title={group}>
            {actions.map((a) => (
              <SettingsRow key={a.id} id={shortcutSettingId(a)} label={a.title} control={<Shortcut keys={a.shortcut!} />} />
            ))}
          </SettingsGroup>
        );
      })}
    </div>
  );
}

export const SHORTCUTS = (ACTIONS as readonly PaletteAction[]).filter((a) => !!a.shortcut);

export const shortcutSettingId = (action: PaletteAction) => `shortcut-${action.id}`;
