import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAgentSettings } from '../AgentSettings';
import { CommitInput, DesktopOnly, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs, type Prefs } from '../prefs';

export function TerminalSection() {
  const { terminalFontSize, terminalScrollback } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <DesktopOnly what="Choosing the shell and restoring terminals need the Mochi desktop app; the web build's terminal plays a scripted demo.">
        <ShellGroup />
      </DesktopOnly>
      <SettingsGroup footer="Open terminals change right away.">
        <SettingsRow id="terminalFontSize" label="Font size" control={<NumberPref id="terminalFontSize" value={terminalFontSize} {...RANGES.terminalFontSize} />} />
        <SettingsRow id="terminalScrollback" label="Scrollback lines" control={<NumberPref id="terminalScrollback" value={terminalScrollback} {...RANGES.terminalScrollback} />} />
      </SettingsGroup>
    </div>
  );
}

const RANGES = {
  terminalFontSize: { min: 9, max: 24, step: 1 },
  terminalScrollback: { min: 1000, max: 100_000, step: 1000 },
} satisfies Partial<Record<keyof Prefs, { min: number; max: number; step: number }>>;

/** A number field that saves on blur or Enter, clamped to its range. */
function NumberPref({ id, value, min, max, step }: { id: keyof typeof RANGES; value: number; min: number; max: number; step: number }) {
  const commit = (raw: string) => {
    const next = Math.min(max, Math.max(min, Math.round(Number(raw) || value)));
    if (next !== value) setPrefs({ [id]: next });
  };
  return (
    <Input
      id={settingControlId(id)}
      key={value}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-24 tabular"
    />
  );
}

function ShellGroup() {
  const { settings, update } = useAgentSettings();
  const { restoreTerminals } = usePrefs();
  if (!settings) return null;
  return (
    <SettingsGroup footer="New terminals start this shell; leave it empty for your login shell ($SHELL). Only zsh gets the failed-command fix prompt. Restoring brings back each thread's terminal tabs and recent output; the shells start fresh.">
      <SettingsRow
        id="shell"
        label="Shell"
        control={<CommitInput id={settingControlId('shell')} value={settings.shell} placeholder="$SHELL" onCommit={(shell) => void update({ shell })} className="font-mono placeholder:font-mono" />}
      />
      <SettingsRow id="restoreTerminals" label="Restore terminals on launch" control={<Switch id={settingControlId('restoreTerminals')} checked={restoreTerminals} onCheckedChange={(on) => setPrefs({ restoreTerminals: on })} />} />
    </SettingsGroup>
  );
}
