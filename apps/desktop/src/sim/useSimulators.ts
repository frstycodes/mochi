import { host } from '@/host';
import type { Simulator } from '@mochi/domain/host/types/sim';
import { queryKeys } from '../queryKeys';
import { useWatchQuery } from '../watch/useWatchQuery';

/** Simulators on this Mac, pushed by Core while something shows them, so boots from Xcode or the CLI show up. */
export function useSimulators() {
  const [simulatorsQuery, refresh] = useWatchQuery(
    queryKeys.sim.list(),
    { _tag: 'sim' },
    (value) => value.simulators as Simulator[],
    () => host.sim.list(),
  );
  return {
    simulators: simulatorsQuery.data ?? null,
    error: simulatorsQuery.error ? message(simulatorsQuery.error) : null,
    refresh,
  };
}

/** Electron prefixes IPC errors with "Error invoking remote method 'sim:x': Error: "; the rest is the useful part. */
export function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(
    /^Error invoking remote method '[^']+': (?:\w*Error: )?/,
    '',
  );
}
