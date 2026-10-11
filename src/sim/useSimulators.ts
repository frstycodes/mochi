import { useCallback, useEffect, useState } from 'react';
import { host } from '@/host';
import type { Simulator } from '@/host/types/sim';

const POLL_MS = 5000;

/** Simulators on this Mac, refreshed every few seconds so boots from Xcode or the CLI show up. */
export function useSimulators() {
  const [simulators, setSimulators] = useState<Simulator[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSimulators(await host.sim.list());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { simulators, error, refresh };
}

/** Electron prefixes IPC errors with "Error invoking remote method 'sim:x': Error: "; the rest is the useful part. */
export function message(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}
