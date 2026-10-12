import { Input } from '@/components/ui/input';
import { CONCURRENCY_RANGE } from '../../host/types/settings';
import { useAgentSettings } from '../AgentSettings';
import { SettingsGroup, SettingsRow, settingControlId } from '../parts';

/** R1 rows only; Agent, Permissions and Runs on (SETTINGS.md, "now") join when they're wired. */
export function DefaultsSection() {
  const { settings, update } = useAgentSettings();
  return (
    <div className="flex flex-col gap-8">
      {!!settings && (
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
      )}
      <SettingsGroup footer="Continuing on your API key or handing off to another harness is your call, per thread. Harness never switches a thread to another account.">
        <SettingsRow id="usageLimit" label="When a usage limit hits" control={<span className="type-body text-muted-foreground">Pause until reset</span>} />
      </SettingsGroup>
    </div>
  );
}
