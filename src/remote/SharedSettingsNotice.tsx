import { useCallback, useEffect, useMemo, useState } from 'react';
import { Refresh } from '@/icons';
import { toast } from '@/toast/store';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { FollowedMachine } from '../host/types/remote';
import { useSettingSources } from '../settings/CatalogRow';
import { findSetting, settingsCatalog } from '../settings/catalog';
import { driftedKeys, sharedValues } from './sharedSettings';
import { useMachines } from './useMachines';

const canWrite = (machine: FollowedMachine) => machine.status === 'online' && machine.scopes.includes('manage');

/**
 * A shared setting changed here, written to each of your other computers that's online and lets this one manage it. One
 * that's offline or refuses is told apart in a single toast; `SharedSettingsNotice` offers the value again later.
 */
export function useShareSetting() {
  const { machines, ask } = useMachines();
  return useCallback(
    (key: string, value: string) => {
      const targets = machines.map((m) => m.machine).filter(canWrite);
      void Promise.allSettled(targets.map((machine) => ask(machine.id, { type: 'setting', key, value }))).then((results) => {
        const failed = results.flatMap((r, i) =>
          r.status === 'rejected' ? [`${targets[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : [],
        );
        if (failed.length > 0) toast.error('Not changed on every computer', { description: failed.join('\n') });
      });
    },
    [machines, ask],
  );
}

/** Above Settings: your other computers whose shared settings differ from this one's, each with a way to bring them in line. */
export function SharedSettingsNotice() {
  const drifts = useSharedSettingsDrift();
  return drifts.map((drift) => <DriftAlert key={drift.machine.id} {...drift} />);
}

interface Drift {
  machine: FollowedMachine;
  /** Each differing setting with this computer's value. */
  changes: { key: string; label: string; value: string }[];
  refresh: () => void;
}

function DriftAlert({ machine, changes, refresh }: Drift) {
  const { ask } = useMachines();
  const [isApplying, setIsApplying] = useState(false);
  const apply = async () => {
    setIsApplying(true);
    const results = await Promise.allSettled(changes.map(({ key, value }) => ask(machine.id, { type: 'setting', key, value })));
    setIsApplying(false);
    const failed = results.flatMap((r, i) =>
      r.status === 'rejected' ? [`${changes[i].label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : [],
    );
    if (failed.length > 0) toast.error(`Not all changed on ${machine.name}`, { description: failed.join('\n') });
    refresh();
  };
  const names = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(changes.slice(0, 3).map((c) => c.label));
  const more = changes.length - 3;
  return (
    <Alert>
      <Refresh />
      <AlertTitle>{machine.name} has different settings</AlertTitle>
      <AlertDescription>
        {names}
        {more > 0 && ` and ${more} more`} differ from this computer’s.
      </AlertDescription>
      {machine.scopes.includes('manage') && (
        <AlertAction>
          <Button variant="secondary" size="sm" disabled={isApplying} onClick={() => void apply()}>
            {isApplying && <Spinner data-icon="inline-start" />}
            Use this computer’s
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

/** Reads each online computer's shared settings when Settings opens and whenever one comes online, and compares them with this one's. */
function useSharedSettingsDrift(): Drift[] {
  const { machines, ask } = useMachines();
  const { sources } = useSettingSources(undefined, false);
  const local = useMemo(() => sharedValues(sources), [sources]);
  const [remote, setRemote] = useState<Record<string, Record<string, string>>>({});
  const [nonce, setNonce] = useState(0);
  const online = machines.map((m) => m.machine).filter((m) => m.status === 'online' && m.scopes.includes('read'));
  const onlineKey = online.map((m) => m.id).join(',');
  useEffect(() => {
    let isCurrent = true;
    for (const machine of online)
      ask(machine.id, { type: 'settings' }).then(
        (values) => isCurrent && setRemote((all) => ({ ...all, [machine.id]: values })),
        () => {},
      );
    return () => {
      isCurrent = false;
    };
  }, [onlineKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = settingsCatalog();
  const refresh = () => setNonce((n) => n + 1);
  return online.flatMap((machine) => {
    const values = remote[machine.id];
    if (!values) return [];
    const changes = driftedKeys(local, values).map((key) => ({ key, label: findSetting(catalog, key)?.label ?? key, value: local[key] }));
    return changes.length > 0 ? [{ machine, changes, refresh }] : [];
  });
}
