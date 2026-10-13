import { useCallback, useEffect, useState } from 'react';
import { host } from '../host/index.ts';
import type { AccountLimits } from '../host/types/agent.ts';
import type { Provider } from '../model.ts';

/** The profile's `provider` account windows as main keeps them, live; `refresh` asks the provider again (main throttles it). */
export function useAccountLimits(provider: Provider, spaceId: string) {
  const [limits, setLimits] = useState<AccountLimits | null>(null);
  const load = useCallback(
    (refresh?: boolean) =>
      void host.agent.limits(provider, spaceId, refresh).then(
        (l) => setLimits(l),
        () => {},
      ),
    [provider, spaceId],
  );
  useEffect(() => {
    setLimits(null);
    load();
    return host.agent.onLimits((l) => setLimits((current) => (current?.accountId === l.accountId ? l : current)));
  }, [load]);
  return { limits, refresh: useCallback(() => load(true), [load]) };
}
