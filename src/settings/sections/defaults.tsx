import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ACCESS, DEVICES } from '../../Composer';
import { CONCURRENCY_RANGE } from '../../host/types/settings';
import { useAgentSettings } from '../AgentSettings';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { DesktopOnly, SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs, type Prefs } from '../prefs';

export function DefaultsSection() {
  const { agent, permissions, runsOn } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Where a new thread starts; the composer can still change each one.">
        <SettingsRow id="agent" label="Agent" control={<SettingsChoice id="agent" value={agent} options={AGENTS} onChange={(v) => setPrefs({ agent: v })} />} />
        <SettingsRow
          id="permissions"
          label="Permissions"
          control={<SettingsChoice id="permissions" value={permissions} options={ACCESS.map((a) => ({ value: a, label: a }))} onChange={(v) => setPrefs({ permissions: v })} />}
        />
        <SettingsRow
          id="runsOn"
          label="Runs on"
          control={
            <NativeSelect id={settingControlId('runsOn')} value={runsOn} onChange={(e) => setPrefs({ runsOn: e.target.value as Prefs['runsOn'] })}>
              {DEVICES.map((d) => (
                <NativeSelectOption key={d} value={d}>
                  {d}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </SettingsGroup>
      <DesktopOnly what="The concurrency limit only works in the Mochi desktop app.">
        <ConcurrencyGroup />
      </DesktopOnly>
      <SettingsGroup footer="Continuing on your API key or handing off to another harness is your call, per thread. Mochi never switches a thread to another account.">
        <SettingsRow id="usageLimit" label="When a usage limit hits" control={<span className="type-body text-muted-foreground">Pause until reset</span>} />
      </SettingsGroup>
    </div>
  );
}

const AGENTS = HARNESS_IDS.map((id) => ({ value: id, label: HARNESSES[id].name }));

function ConcurrencyGroup() {
  const { settings, update } = useAgentSettings();
  if (!settings) return null;
  return (
    <SettingsGroup footer="A thread with its own process (Claude Code runs one per thread) waits its turn past this limit.">
      <SettingsRow
        id="concurrency"
        label="Agents running at once"
        control={
          <Input
            id={settingControlId('concurrency')}
            key={settings.concurrency}
            type="number"
            inputMode="numeric"
            min={CONCURRENCY_RANGE.min}
            max={CONCURRENCY_RANGE.max}
            defaultValue={settings.concurrency}
            onBlur={(e) => Number(e.target.value) !== settings.concurrency && void update({ concurrency: Number(e.target.value) })}
            className="w-20 tabular"
          />
        }
      />
    </SettingsGroup>
  );
}
