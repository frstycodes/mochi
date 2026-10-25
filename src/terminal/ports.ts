import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { host } from '../host/index.ts';
import type { PortsListing } from '../host/types/ports.ts';
import { recordListeningPorts } from './devServer.ts';
import { queryKeys } from '../queryKeys.ts';
import { markStale, useWatchQuery } from '../watch/useWatchQuery.ts';

/** Listening ports under the thread's cwd, from Core's one app-wide scan; the last result stays for `listeningPorts`. */
export function usePorts(threadId: string, cwd: string | null) {
  // A folderless chat has no processes of its own to list.
  const [portsQuery] = useWatchQuery(
    queryKeys.ports.listening(cwd),
    cwd ? { _tag: 'ports', cwd } : null,
    (value) => value.listing as PortsListing,
    async () => (await host.ports.list([cwd!]))[0]!,
  );
  const listing = portsQuery.data;
  const ports = listing && 'ports' in listing ? listing.ports : undefined;
  useEffect(() => {
    if (ports) recordListeningPorts(threadId, ports);
  }, [threadId, ports]);
  return {
    ports,
    error:
      listing && 'error' in listing ? listing.error : portsQuery.error?.message,
  };
}

/** Port → configuration name from `cwd`'s .claude/launch.json. */
export function useLaunchNames(cwd: string | null) {
  const targetsQuery = useQuery({
    queryKey: queryKeys.ports.launchTargets(cwd),
    queryFn: () => host.ports.targets(cwd!),
    enabled: !!cwd,
  });
  return new Map(
    (targetsQuery.data ?? []).flatMap((t) =>
      t.source === 'launch.json' && t.port ? [[t.port, t.name] as const] : [],
    ),
  );
}

/** After starting or killing a server: scan now rather than at the next interval. */
export function refreshPorts() {
  void markStale(['ports']);
}
