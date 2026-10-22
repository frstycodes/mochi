import { useQuery } from '@tanstack/react-query';
import { host } from '@/host';
import { queryKeys } from '../queryKeys';

const POLL_MS = 5000;

/** Simulators on this Mac, refreshed every few seconds so boots from Xcode or the CLI show up. */
export function useSimulators() {
  const simulatorsQuery = useQuery({ queryKey: queryKeys.sim.list(), queryFn: () => host.sim.list(), refetchInterval: POLL_MS });
  return { simulators: simulatorsQuery.data ?? null, error: simulatorsQuery.error ? message(simulatorsQuery.error) : null, refresh: async () => { await simulatorsQuery.refetch(); } };
}

/** Electron prefixes IPC errors with "Error invoking remote method 'sim:x': Error: "; the rest is the useful part. */
export function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}
