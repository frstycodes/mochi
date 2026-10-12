import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { CommitInput, SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { DEFAULT_PREFS, setPrefs, usePrefs } from '../prefs';

export function GeneralSection() {
  const { theme = 'system', setTheme } = useTheme();
  const { reduceMotion, projectsFolder, restoreLayout } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="System follows your OS appearance and its Reduce motion setting.">
        <SettingsRow id="theme" label="Theme" control={<SettingsChoice id="theme" value={theme as (typeof THEMES)[number]['value']} options={THEMES} onChange={setTheme} />} />
        <SettingsRow id="reduceMotion" label="Reduce motion" control={<SettingsChoice id="reduceMotion" value={reduceMotion} options={MOTION} onChange={(v) => setPrefs({ reduceMotion: v })} />} />
      </SettingsGroup>
      <SettingsGroup footer="Open folder in the new thread's project picker starts here.">
        <SettingsRow
          id="projectsFolder"
          label="Projects folder"
          control={<CommitInput id={settingControlId('projectsFolder')} value={projectsFolder} placeholder={DEFAULT_PREFS.projectsFolder} onCommit={(path) => setPrefs({ projectsFolder: path || DEFAULT_PREFS.projectsFolder })} />}
        />
      </SettingsGroup>
      <SettingsGroup footer="Off: every launch opens each space on its default view.">
        <SettingsRow id="restoreLayout" label="Restore layout on launch" control={<Switch id={settingControlId('restoreLayout')} checked={restoreLayout} onCheckedChange={(on) => setPrefs({ restoreLayout: on })} />} />
      </SettingsGroup>
    </div>
  );
}

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

const MOTION = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;
