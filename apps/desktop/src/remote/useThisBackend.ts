import type { Backend } from '@mochi/schema';
import { LOCAL_BACKEND, useBackend } from '../backends/registry.ts';
import type { DeviceKind } from '../host/types/remote.ts';
import { THIS_DEVICE } from './DeviceIcon.tsx';

/** What the window shows for this computer until its Core has answered, or where there is no Core. */
const FALLBACK = { name: 'This computer', kind: THIS_DEVICE } as const;

/**
 * This computer as its own Core describes it (its registry entry's `backend.watch`), the way another machine is described by
 * its welcome: the name and icon follow a rename and the OS the Core runs on. `kind` is undefined for a headless Core, which `DeviceIcon` draws as
 * a plain computer.
 */
export function useThisBackend(): {
  name: string;
  kind: DeviceKind | undefined;
  info: Backend.BackendInfo | undefined;
} {
  const info = useBackend(LOCAL_BACKEND)?.descriptor;
  if (!info) return { ...FALLBACK, info: undefined };
  return {
    name: info.name,
    kind: info.kind === 'server' ? undefined : info.kind,
    info,
  };
}
