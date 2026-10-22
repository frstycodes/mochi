import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { OtherMachine } from '../host/types/remote';
import { ipcMessage } from '../settings/AgentSettings';
import { queryKeys } from '../queryKeys';

/** Computers on your account that aren't among yours yet, through the relay, and joining through one. Loads only while signed in. */
export function useOtherMachines(isSignedIn: boolean) {
  const machinesQuery = useQuery({ queryKey: queryKeys.remote.otherMachines(), queryFn: () => host.remote.otherMachines(), enabled: isSignedIn });
  const machines = isSignedIn ? machinesQuery.data ?? null : null;
  const error = machinesQuery.error ? ipcMessage(machinesQuery.error) : null;
  const refresh = machinesQuery.refetch;
  const [joining, setJoining] = useState<{ machine: OtherMachine; error?: string } | null>(null);

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
