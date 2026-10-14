import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { host } from '../host/index.ts';
import type { RemoteSettings, RemoteStatus } from '../host/types/remote.ts';

/** Settings › Devices as main reports it, live; null until the first read. */
export function useRemoteStatus(isEnabled = true) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  useEffect(() => {
    if (!isEnabled) return;
    void host.remote.status().then(setStatus, (error: Error) => toast.error('Couldn’t read Settings › Devices', { description: error.message }));
    return host.remote.onStatus(setStatus);
  }, [isEnabled]);
  const update = (patch: Partial<RemoteSettings>) => host.remote.set(patch).then(setStatus, (error: Error) => toast.error('Couldn’t change Settings › Devices', { description: error.message }));
  return { status, update };
}
