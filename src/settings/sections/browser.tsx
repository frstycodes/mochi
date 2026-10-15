import { Trash3 } from 'reicon-react';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { replaceAddressHistory, useAddressHistory } from '../../browser/pages';
import { useSimulators } from '../../sim/useSimulators';
import { SettingsGroup, SettingsRow, SettingsSelect, settingControlId, UNDO_MS } from '../parts';
import { CatalogRow } from '../CatalogRow';

export function BrowserSection() {
  const history = useAddressHistory();
  const clearHistory = () => {
    const previous = replaceAddressHistory([]);
    toast('Address history cleared', { duration: UNDO_MS, action: { label: 'Undo', onClick: () => replaceAddressHistory(previous) } });
  };
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="What the address bar searches when you type something that isn't a URL.">
        <CatalogRow settingKey="searchEngine" />
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


// Radix Select can't hold '' (the pref's "first booted"), so the choice uses its own value for it.
const FIRST_BOOTED = 'first-booted';

function SimulatorGroup() {
  return (
    <SettingsGroup footer="The Simulator tab opens on this device; you can still switch per thread. A simulator that's gone falls back to the first booted one.">
      <CatalogRow settingKey="simulator" />
    </SettingsGroup>
  );
}

/** Booted and available simulators by udid, '' for "first booted"; a saved one that's gone shows as first booted. */
export function SimulatorSelect({ id, value, onChange }: { id: string; value: string; onChange: (udid: string) => void }) {
  const { simulators } = useSimulators();
  const isMissing = !!value && !!simulators && !simulators.some((s) => s.udid === value);
  return (
    <SettingsSelect
      id={id}
      value={isMissing || !value ? FIRST_BOOTED : value}
      options={[{ value: FIRST_BOOTED, label: 'First booted' }, ...(simulators ?? []).map((s) => ({ value: s.udid, label: `${s.name} (${s.runtime})` }))]}
      onChange={(v) => onChange(v === FIRST_BOOTED ? '' : v)}
      disabled={!simulators}
      className="w-56"
    />
  );
}
