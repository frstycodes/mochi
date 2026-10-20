import { useCallback, useEffect, useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { OtherMachine } from '../host/types/remote';
import { ipcMessage } from '../settings/AgentSettings';

/** Computers on your account that aren't among yours yet, through the relay, and joining through one. Loads only while signed in. */
export function useOtherMachines(isSignedIn: boolean) {
  const [machines, setMachines] = useState<OtherMachine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<{ machine: OtherMachine; error?: string } | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    return host.remote.otherMachines().then(setMachines, (e: Error) => setError(ipcMessage(e)));
  }, []);
  useEffect(() => {
    if (isSignedIn) void refresh();
  }, [isSignedIn, refresh]);

  const join = async (machine: OtherMachine) => {
    setJoining({ machine });
    try {
      await host.remote.join(machine.id);
      setJoining(null);
      toast.success(`Joined your computers through ${machine.name}`);
      void refresh();
    } catch (e) {
      setJoining((current) => (current?.machine.id === machine.id ? { machine, error: ipcMessage(e as Error) } : current));
    }
  };

  return { machines, error, refresh, joining, join, closeJoining: () => setJoining(null) };
}
