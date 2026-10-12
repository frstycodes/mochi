import { Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { replaceAddressHistory, useAddressHistory } from '../../browser/pages';
import { SEARCH_ENGINES } from '../../browser/url';
import { useSimulators } from '../../sim/useSimulators';
import { SettingsGroup, SettingsRow, SettingsSelect, settingControlId, UNDO_MS } from '../parts';
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
          control={<SettingsSelect id="searchEngine" value={searchEngine} options={ENGINES} onChange={(v) => setPrefs({ searchEngine: v })} />}
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

export const ENGINES = (Object.keys(SEARCH_ENGINES) as Prefs['searchEngine'][]).map((id) => ({ value: id, label: SEARCH_ENGINES[id].name }));

// Radix Select can't hold '' (the pref's "first booted"), so the choice uses its own value for it.
const FIRST_BOOTED = 'first-booted';

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
          <SettingsSelect
            id="simulator"
            value={isMissing || !simulator ? FIRST_BOOTED : simulator}
            options={[{ value: FIRST_BOOTED, label: 'First booted' }, ...(simulators ?? []).map((s) => ({ value: s.udid, label: `${s.name} (${s.runtime})` }))]}
            onChange={(v) => setPrefs({ simulator: v === FIRST_BOOTED ? '' : v })}
            disabled={!simulators}
            className="w-56"
          />
        }
      />
    </SettingsGroup>
  );
}
