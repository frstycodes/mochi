import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { OtherMachine } from '../host/types/remote';
import { ipcMessage } from '../settings/AgentSettings';
import { queryKeys } from '../queryKeys';

const OTHER_MACHINES_POLL_MS = 5000;

/** Computers on your account that aren't among yours yet, through the relay, and joining through one. Loads only while signed in. */
export function useOtherMachines(isSignedIn: boolean) {
  const machinesQuery = useQuery({
    queryKey: queryKeys.remote.otherMachines(),
    queryFn: () => host.remote.otherMachines(),
    enabled: isSignedIn,
    // The relay's presence changes under an open list: a computer that comes online shows without a reopen.
    refetchInterval: OTHER_MACHINES_POLL_MS,
  });
  const machines = isSignedIn ? (machinesQuery.data ?? null) : null;
  const error = machinesQuery.error ? ipcMessage(machinesQuery.error) : null;
  // Only your own refresh spins: the poll runs quietly underneath.
  const [isRefreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await machinesQuery.refetch().finally(() => setRefreshing(false));
  };
  const [joining, setJoining] = useState<{
    machine: OtherMachine;
    error?: string;
  } | null>(null);

  const join = async (machine: OtherMachine) => {
    setJoining({ machine });
    try {
      await host.remote.join(machine.id);
      setJoining(null);
      toast.success(`Joined your computers through ${machine.name}`);
      void refresh();
    } catch (e) {
      setJoining((current) =>
        current?.machine.id === machine.id
          ? { machine, error: ipcMessage(e as Error) }
          : current,
      );
    }
  };

  return {
    machines,
    error,
    refresh,
    isRefreshing,
    joining,
    join,
    closeJoining: () => setJoining(null),
  };
}
