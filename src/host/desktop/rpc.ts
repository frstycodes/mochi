import { Effect, Scope } from 'effect';
import { manifest, type HostBridge, type Namespace } from '../types/index.ts';
import { bridge } from './bridge.ts';

let caller: ReturnType<typeof connect> | undefined;

/** Main posts a fresh port after each page load; the client lives as long as the page. */
function connect() {
  return new Promise<(tag: string, args: ReadonlyArray<unknown>) => Promise<unknown>>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const [port] = event.ports;
      if (event.source !== window || event.data !== 'host:port' || !port) return;
      window.removeEventListener('message', onMessage);
      void import('@mochi/core/hostClient').then(({ makeHostCaller }) => resolve(Effect.runPromise(Scope.provide(makeHostCaller(port), Scope.makeUnsafe()))));
    };
    window.addEventListener('message', onMessage);
  });
}

const call = async (tag: string, args: ReadonlyArray<unknown>) => (await (caller ??= connect()))(tag, args);

/** `host.<ns>` on desktop: request/response methods are RPCs to main, push methods come from the preload. */
export function desktopNamespace<K extends Namespace>(ns: K): HostBridge[K] {
  caller ??= connect();
  const events = bridge()[ns] as unknown as Record<string, unknown>;
  const methods = Object.entries(manifest[ns]).map(([method, kind]) => [method, kind === 'invoke' ? (...args: unknown[]) => call(`${ns}.${method}`, args) : events[method]]);
  return Object.fromEntries(methods) as HostBridge[K];
}
