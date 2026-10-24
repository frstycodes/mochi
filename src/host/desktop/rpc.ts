import type { CoreClient } from '@mochi/core/client';
import { manifest, type HostBridge, type Namespace } from '../types/index.ts';
import { bridge } from './bridge.ts';

let client: Promise<CoreClient> | undefined;

/** Main posts Core's socket URL after each page load; the client lives as long as the page and redials on its own. */
function connect() {
  return new Promise<CoreClient>((resolve) => {
    const onMessage = (event: MessageEvent<{ channel?: string; url?: string }>) => {
      if (event.source !== window || event.data?.channel !== 'core:url' || typeof event.data.url !== 'string') return;
      window.removeEventListener('message', onMessage);
      const url = event.data.url;
      void import('@mochi/core/client').then(async ({ connectCore }) => resolve((await connectCore(url)).client));
    };
    window.addEventListener('message', onMessage);
  });
}

/** This window's connection to Core, for its streams (`watch`); `host.*` calls go through it too. */
export const coreClient = () => (client ??= connect());

let caller: Promise<(tag: string, args: ReadonlyArray<unknown>) => Promise<unknown>> | undefined;
const call = async (tag: string, args: ReadonlyArray<unknown>) =>
  (await (caller ??= Promise.all([coreClient(), import('@mochi/core/hostClient')]).then(([client, { makeHostCaller }]) => makeHostCaller(client))))(tag, args);

/** One of Core's own procedures (not a `host.*` method), called with its payload. */
export const callCore = <T>(tag: string, payload: unknown) => call(tag, payload as ReadonlyArray<unknown>) as Promise<T>;

/** `host.<ns>` on desktop: request/response methods are RPCs to Core, push methods come from the preload. */
export function desktopNamespace<K extends Namespace>(ns: K): HostBridge[K] {
  void coreClient();
  const events = bridge()[ns] as unknown as Record<string, unknown>;
  const methods = Object.entries(manifest[ns]).map(([method, kind]) => [method, kind === 'invoke' ? (...args: unknown[]) => call(`${ns}.${method}`, args) : events[method]]);
  return Object.fromEntries(methods) as HostBridge[K];
}
