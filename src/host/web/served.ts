import { callCore } from '../desktop/rpc.ts';
import { manifest, type HostBridge, type Namespace } from '../types/index.ts';

/**
 * `host.<ns>` in a page Core serves: request/response methods are RPCs to Core, as on desktop. Push methods are main's IPC,
 * which a browser has none of, so they never fire.
 */
export function servedNamespace<K extends Namespace>(ns: K): HostBridge[K] {
  const methods = Object.entries(manifest[ns]).map(([method, kind]) => [
    method,
    kind === 'invoke'
      ? (...args: unknown[]) => callCore(`${ns}.${method}`, args)
      : () => () => {},
  ]);
  return Object.fromEntries(methods) as HostBridge[K];
}
