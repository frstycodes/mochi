import { persistedFamily } from '../lib/uiStorage.ts';
import { useEffect, useRef } from 'react';
import { toast } from '../toast/store';
import { host } from '../host';
import type { RemoteThreadRoute } from '../routes/locations';
import { openRemoteThread, useRemoteThreadRoute } from '../routes/nav';
import { useMachines } from '../remote/useMachines';
import type { State } from '../store';
import { usePrefs } from '../settings/prefs';
import { useHarness } from '../store';
import { alertsToShow, baselineOf, remoteAlerts, type RemoteBaseline } from './remote';

const baselineSlice = persistedFamily<RemoteBaseline | null>('harness:remote-alerts:', null);

/**
 * Your other computers' threads alert here as this computer's own do: an OS notification while Mochi is in the background,
 * a toast while it's in front, under the same switches and quiet hours. Clicking one opens that thread.
 */
export function useRemoteAlerts() {
  const { machines } = useMachines();
  const { state } = useHarness();
  const { alertKinds } = usePrefs();
  const route = useRemoteThreadRoute();
  const latest = useRef({ quiet: state.notifications.quiet, alertKinds, route });
  latest.current = { quiet: state.notifications.quiet, alertKinds, route };
  const seen = useRef(new Map<string, State>());
  const opens = useRef(new Map<string, RemoteThreadRoute>());

  useEffect(() => {
    for (const { machine, state: mirrored } of machines) {
      if (!mirrored || seen.current.get(machine.id) === mirrored) continue;
      seen.current.set(machine.id, mirrored);
      const { quiet, alertKinds, route } = latest.current;
      const isFocused = document.hasFocus();
      const alerts = alertsToShow(remoteAlerts(advanceBaseline(machine.id, mirrored), mirrored), { kinds: alertKinds, quiet }, new Date()).filter(
        (a) => !(isFocused && route?.machineId === machine.id && route.threadId === a.threadId),
      );
      if (alerts.length === 0) continue;
      const open = (threadId: string) => openRemoteThread({ machineId: machine.id, threadId });
      if (isFocused) {
        for (const a of alerts) toast(a.title, { description: `On ${machine.name}: ${a.body}`, action: { label: 'Open', onClick: () => open(a.threadId) } });
        continue;
      }
      const [first] = alerts;
      // A burst in one update becomes one OS notification instead of a stack, as for this computer's own.
      const shown = alerts.length > 2 ? [{ ...first, title: `${alerts.length} threads on ${machine.name} need a look`, body: alerts.map((a) => a.title).join('\n') }] : alerts.map((a) => ({ ...a, body: `On ${machine.name}: ${a.body}` }));
      for (const a of shown) {
        const id = `remote:${machine.id}:${a.id}`;
        opens.current.set(id, { machineId: machine.id, threadId: a.threadId });
        host.notify.show({ id, title: a.title, body: a.body }).catch(() => undefined);
      }
    }
  }, [machines]);

  useEffect(
    () =>
      host.notify.onClick((id) => {
        const target = opens.current.get(id);
        if (!target) return;
        opens.current.delete(id);
        openRemoteThread(target);
      }),
    [],
  );
}

/** The baseline that machine's alerts diff against, now moved to `state`; undefined the first time this computer sees it. */
function advanceBaseline(machineId: string, state: State): RemoteBaseline | undefined {
  const slice = baselineSlice(machineId);
  const saved = slice.getState().value;
  const next = baselineOf(state);
  if (JSON.stringify(saved) !== JSON.stringify(next)) slice.setState({ value: next });
  return saved ?? undefined;
}
