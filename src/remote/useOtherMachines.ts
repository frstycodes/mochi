import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import type { OtherMachine } from '../host/types/remote';
import { ipcMessage } from '../settings/AgentSettings';

/** Your account's other computers through the relay, and pairing with one. Loads only while signed in. */
export function useOtherMachines(isSignedIn: boolean) {
  const [machines, setMachines] = useState<OtherMachine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ machine: OtherMachine; error?: string } | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    return host.remote.otherMachines().then(setMachines, (e: Error) => setError(ipcMessage(e)));
  }, []);
  useEffect(() => {
    if (isSignedIn) void refresh();
  }, [isSignedIn, refresh]);

  const pair = async (machine: OtherMachine) => {
    setPairing({ machine });
    try {
      await host.remote.pair(machine.id);
      setPairing(null);
      toast.success(`Paired with ${machine.name}`);
      void refresh();
    } catch (e) {
      setPairing((current) => (current?.machine.id === machine.id ? { machine, error: ipcMessage(e as Error) } : current));
    }
  };
  const forget = (machine: OtherMachine) => host.remote.forgetMachine(machine.id).then(refresh);

  return { machines, error, refresh, pairing, pair, forget, closePairing: () => setPairing(null) };
}
