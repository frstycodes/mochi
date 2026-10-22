import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { host } from '../host/index.ts';
import type { Provider } from '../model.ts';

/** The profile's `provider` account windows as main keeps them, live; `refresh` asks the provider again (main throttles it). */
export function useAccountLimits(provider: Provider, spaceId: string) {
  const limitsQuery = useQuery({ queryKey: queryKeys.agent.limits(provider, spaceId), queryFn: () => host.agent.limits(provider, spaceId) });
  const limits = limitsQuery.data ?? null;
  useEffect(() => host.agent.onLimits((next) => { if (limits?.accountId === next.accountId) void queryClient.invalidateQueries({ queryKey: queryKeys.agent.limits(provider, spaceId) }); }), [limits?.accountId, provider, spaceId]);
  return { limits, refresh: () => queryClient.fetchQuery({ queryKey: queryKeys.agent.limits(provider, spaceId), queryFn: () => host.agent.limits(provider, spaceId, true), staleTime: 0 }) };
}
