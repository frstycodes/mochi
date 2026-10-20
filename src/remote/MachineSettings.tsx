import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/toast/store';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { FollowedMachine } from '../host/types/remote';
import { MachineModelsContext } from '../ModelControls';
import { SettingControl } from '../settings/CatalogRow';
import { settingsCatalog, valueLabel, type Control, type Setting } from '../settings/catalog';
import { SettingsGroup, SettingsRow } from '../settings/parts';
import { DeviceIcon } from './DeviceIcon';
import { useMachineCatalog, useMachines } from './useMachines';

/** Which computer Settings shows: this one, or another you follow that lets this one read its settings. */
export function SettingsComputerPicker({ value, onChange }: { value: string | null; onChange: (machineId: string | null) => void }) {
  const machines = useMachines().machines.map((m) => m.machine).filter((m) => m.scopes.includes('read'));
  if (machines.length === 0) return null;
  return (
    <Select value={value ?? THIS_COMPUTER} onValueChange={(v) => onChange(v === THIS_COMPUTER ? null : v)}>
      <SelectTrigger size="sm" aria-label="Settings of" className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectItem value={THIS_COMPUTER}>This computer</SelectItem>
          {machines.map((m) => (
            <SelectItem key={m.id} value={m.id} disabled={m.status !== 'online'}>
              <DeviceIcon kind={m.kind} />
              {m.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// Radix reserves the empty string.
const THIS_COMPUTER = 'this';

/**
 * One Settings page as another computer has it: the rows it lets this one change there, with the same controls. Each change
 * runs on that computer; folder fields are typed paths, since a picker here would browse this computer's disk.
 */
export function MachineSettings({ machine, section }: { machine: FollowedMachine; section: string }) {
  const { ask } = useMachines();
  const { catalog } = useMachineCatalog(machine);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      ask(machine.id, { type: 'settings' }).then(
        (read) => (setValues(read), setError(null)),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [ask, machine.id],
  );
  useEffect(() => void load(), [load]);
  const canChange = machine.status === 'online' && machine.scopes.includes('manage');
  const rows = settingsCatalog().filter((s) => s.section === section && REMOTE_CONTROLS.includes(s.control.type) && values && s.key in values);
  const groups = groupRows(rows);

  const change = async (setting: Setting, value: string) => {
    setValues((all) => all && { ...all, [setting.key]: value });
    await ask(machine.id, { type: 'setting', key: setting.key, value }).catch((e: unknown) => toast.error(`${setting.label} not changed on ${machine.name}`, { description: e instanceof Error ? e.message : String(e) }));
    void load();
  };

  if (error) return <MachineSettingsState title={`Couldn’t read ${machine.name}’s settings`} description={error} />;
  if (!values) return <Spinner className="mx-auto" />;
  if (rows.length === 0) return <MachineSettingsState title="Nothing to change here from another computer" description={`Change these on ${machine.name} itself.`} />;
  return (
    <MachineModelsContext.Provider value={catalog ?? NO_CATALOG}>
      {!canChange && <p className="px-1 type-meta text-muted-foreground">{machine.name} lets this computer read its settings only.</p>}
      {[...groups].map(([group, settings]) => (
        <SettingsGroup key={group} title={group || undefined}>
          {settings.map((s) => (
            <SettingsRow
              key={s.key}
              label={s.label}
              description={s.description}
              control={canChange ? <SettingControl setting={remoteControl(s)} value={values[s.key]} rowId={`${machine.id}-${s.key}`} onChange={(v) => void change(s, v)} /> : <span className="type-meta text-muted-foreground">{valueLabel(s, values[s.key])}</span>}
            />
          ))}
        </SettingsGroup>
      ))}
    </MachineModelsContext.Provider>
  );
}

/** Controls that work on another computer's value; pickers that browse this computer (folders, simulators, keys) aren't among them. */
const REMOTE_CONTROLS: Control['type'][] = ['choice', 'select', 'switch', 'number', 'text', 'model'];

const remoteControl = (setting: Setting): Setting => (setting.control.type === 'text' ? { ...setting, control: { ...setting.control, isPath: false } } : setting);

const NO_CATALOG = { models: {}, defaults: { claude: '', codex: '' } };

/** Rows by their titled group, in catalog order. */
function groupRows(rows: Setting[]) {
  const groups = new Map<string, Setting[]>();
  for (const row of rows) groups.set(row.group ?? '', [...(groups.get(row.group ?? '') ?? []), row]);
  return groups;
}

function MachineSettingsState({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
