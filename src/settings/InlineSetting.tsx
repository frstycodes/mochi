import type { ReactNode } from 'react';
import { ArrowRight } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SHARED_ACCESS } from '../runtime/access';
import { EFFORTS } from '../runtime/controls';
import { openSettings } from './open';
import { settingControlId, SettingsSelect } from './parts';
import { setPrefs, usePrefs, type Prefs } from './prefs';
import { ENGINES } from './sections/browser';
import { AGENTS } from './sections/defaults';
import { MOTION } from './sections/general';
import { DIFF_STYLES } from './sections/git';
import { BRANCH_FROM } from './sections/goals';
import { SETTINGS_SECTIONS } from './sections';
import { AGENT_CONTROLS } from './sections/tools';

type Option = { readonly value: string; readonly label: string };

const named = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

/** Prefs an agent can put in front of you with a real control (`show_setting`); every other setting gets a link to its row. */
const CHOICES = {
  agentControl: AGENT_CONTROLS,
  permissions: named(SHARED_ACCESS),
  effort: named(EFFORTS),
  agent: AGENTS,
  branchFrom: BRANCH_FROM,
  diffStyle: DIFF_STYLES,
  searchEngine: ENGINES,
  reduceMotion: MOTION,
} satisfies Partial<Record<keyof Prefs, readonly Option[]>>;

const SWITCHES = ['restoreLayout', 'watchedToasts', 'dockBadge', 'restoreTerminals'] as const satisfies (keyof Prefs)[];

/** One setting as a row: its label, the control (when it's a pref), a one-click suggested value, and a link to its place in Settings. */
export function InlineSetting({ id, suggested, children }: { id: string; suggested?: string; children?: ReactNode }) {
  const prefs = usePrefs();
  const found = findSetting(id);
  const label = found?.label ?? id;
  const choices: readonly Option[] | undefined = CHOICES[id as keyof typeof CHOICES];
  const isSwitch = (SWITCHES as readonly string[]).includes(id);
  const value = String(prefs[id as keyof Prefs] ?? '');
  const suggestion = choices?.find((o) => o.value === suggested) ?? (isSwitch && (suggested === 'true' || suggested === 'false') ? { value: suggested, label: suggested === 'true' ? 'On' : 'Off' } : undefined);
  const set = (v: string) => setPrefs({ [id]: isSwitch ? v === 'true' : v } as Partial<Prefs>);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={settingControlId(`inline-${id}`)} className="min-w-32 flex-1 type-body">
          {label}
        </label>
        {!!choices && <SettingsSelect id={`inline-${id}`} value={value} options={choices} onChange={set} className="w-56" />}
        {isSwitch && <Switch id={settingControlId(`inline-${id}`)} checked={value === 'true'} onCheckedChange={(on) => set(String(on))} />}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => (found ? openSettings(found.section, id) : openSettings())}>
          {found ? 'Open in Settings' : 'Open Settings'}
          <ArrowRight data-icon="inline-end" />
        </Button>
        {children}
        {!!suggestion && suggestion.value !== value && (
          <Button size="sm" onClick={() => set(suggestion.value)}>
            Use {suggestion.label}
          </Button>
        )}
      </div>
    </div>
  );
}

function findSetting(id: string) {
  for (const section of SETTINGS_SECTIONS) {
    const setting = (section.settings as readonly { id: string; label: string }[]).find((s) => s.id === id);
    if (setting) return { section: section.id, label: setting.label };
  }
  return null;
}
