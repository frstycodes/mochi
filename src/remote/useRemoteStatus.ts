import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import type { RemoteSettings } from '../host/types/remote.ts';

/** Settings › Remote access as main reports it, live; null until the first read. */
export function useRemoteStatus(isEnabled = true) {
  const statusQuery = useQuery({
    queryKey: queryKeys.remote.status(),
    queryFn: () => host.remote.status(),
    enabled: isEnabled,
  });
  const status = statusQuery.data ?? null;
  useEffect(() => {
    if (isEnabled)
      return host.remote.onStatus(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.remote.status(),
        });
      });
  }, [isEnabled]);
  const update = (patch: Partial<RemoteSettings>) =>
    host.remote.set(patch).then(
      () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.remote.status() }),
      (error: Error) =>
        toast.error('Couldn’t change Settings › Remote access', {
          description: error.message,
        }),
    );
  return { status, update };
}
