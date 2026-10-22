import { manifest, type HostBridge, type Namespace } from '../types/index.ts';
import { bridge } from './bridge.ts';

let caller: ReturnType<typeof connect> | undefined;

/** Main posts Core's socket URL after each page load; the client lives as long as the page and redials on its own. */
function connect() {
  return new Promise<(tag: string, args: ReadonlyArray<unknown>) => Promise<unknown>>((resolve) => {
    const onMessage = (event: MessageEvent<{ channel?: string; url?: string }>) => {
      if (event.source !== window || event.data?.channel !== 'core:url' || typeof event.data.url !== 'string') return;
      window.removeEventListener('message', onMessage);
      const url = event.data.url;
      void Promise.all([import('@mochi/core/client'), import('@mochi/core/hostClient')]).then(async ([{ connectCore }, { makeHostCaller }]) =>
        resolve(makeHostCaller((await connectCore(url)).client)),
      );
    };
    window.addEventListener('message', onMessage);
  });
}

const call = async (tag: string, args: ReadonlyArray<unknown>) => (await (caller ??= connect()))(tag, args);

/** `host.<ns>` on desktop: request/response methods are RPCs to Core, push methods come from the preload. */
export function desktopNamespace<K extends Namespace>(ns: K): HostBridge[K] {
  caller ??= connect();
  const events = bridge()[ns] as unknown as Record<string, unknown>;
  const methods = Object.entries(manifest[ns]).map(([method, kind]) => [method, kind === 'invoke' ? (...args: unknown[]) => call(`${ns}.${method}`, args) : events[method]]);
  return Object.fromEntries(methods) as HostBridge[K];
}
