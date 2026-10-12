import { Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { replaceAddressHistory, useAddressHistory } from '../../browser/pages';
import { SEARCH_ENGINES } from '../../browser/url';
import { useSimulators } from '../../sim/useSimulators';
import { SettingsGroup, SettingsRow, settingControlId, UNDO_MS } from '../parts';
import { setPrefs, usePrefs, type Prefs } from '../prefs';

export function BrowserSection() {
  const { searchEngine } = usePrefs();
  const history = useAddressHistory();
  const clearHistory = () => {
    const previous = replaceAddressHistory([]);
    toast('Address history cleared', { duration: UNDO_MS, action: { label: 'Undo', onClick: () => replaceAddressHistory(previous) } });
  };
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="What the address bar searches when you type something that isn't a URL.">
        <SettingsRow
          id="searchEngine"
          label="Search engine"
          control={
            <NativeSelect id={settingControlId('searchEngine')} value={searchEngine} onChange={(e) => setPrefs({ searchEngine: e.target.value as Prefs['searchEngine'] })}>
              {Object.entries(SEARCH_ENGINES).map(([id, { name }]) => (
                <NativeSelectOption key={id} value={id}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
        <SettingsRow
          id="addressHistory"
          label="Address history"
          description={history.length ? `${history.length} ${PAGES.select(history.length) === 'one' ? 'page' : 'pages'} suggested as you type` : 'Empty'}
          control={
            <Button id={settingControlId('addressHistory')} variant="outline" size="sm" disabled={!history.length} onClick={clearHistory}>
              <Trash3 data-icon="inline-start" />
              Clear history
            </Button>
          }
        />
      </SettingsGroup>
      <SimulatorGroup />
    </div>
  );
}

const PAGES = new Intl.PluralRules('en');

function SimulatorGroup() {
  const { simulator } = usePrefs();
  const { simulators } = useSimulators();
  const isMissing = !!simulator && !!simulators && !simulators.some((s) => s.udid === simulator);
  return (
    <SettingsGroup footer="The Simulator tab opens on this device; you can still switch per thread.">
      <SettingsRow
        id="simulator"
        label="Default simulator"
        description={isMissing ? 'That simulator is gone, so the first booted one is used.' : undefined}
        control={
          <NativeSelect id={settingControlId('simulator')} value={simulator} onChange={(e) => setPrefs({ simulator: e.target.value })} disabled={!simulators}>
            <NativeSelectOption value="">First booted</NativeSelectOption>
            {simulators?.map((s) => (
              <NativeSelectOption key={s.udid} value={s.udid}>
                {s.name} ({s.runtime})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      />
    </SettingsGroup>
  );
}
