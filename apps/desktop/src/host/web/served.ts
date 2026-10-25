import { Effect, Schedule, Stream } from 'effect';
import { callCore, coreClient } from '../desktop/rpc.ts';
import { manifest, type HostBridge, type Namespace } from '../types/index.ts';

/**
 * `host.<ns>` in a page Core serves: request/response methods are RPCs to Core, as on desktop. Push methods listen on Core's
 * push stream, which main relays to its windows on desktop; only what Core itself pushes reaches a browser.
 */
export function servedNamespace<K extends Namespace>(ns: K): HostBridge[K] {
  const methods = Object.entries(manifest[ns]).map(([method, kind]) => [
    method,
    kind === 'invoke'
      ? (...args: unknown[]) => callCore(`${ns}.${method}`, args)
      : (listener: (payload: unknown) => void) =>
          listen(`${ns}:${method}`, listener),
  ]);
  return Object.fromEntries(methods) as HostBridge[K];
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();
let isSubscribed = false;

function listen(channel: string, listener: (payload: unknown) => void) {
  if (!isSubscribed) subscribe();
  const set = listeners.get(channel) ?? new Set();
  listeners.set(channel, set.add(listener));
  return () => void set.delete(listener);
}

// A browser is no window of main's, so a push addressed to one is not for it.
function subscribe() {
  isSubscribed = true;
  void coreClient().then((client) =>
    Effect.runFork(
      client.agentPush().pipe(
        Stream.runForEach(({ channel, payload, windowId }) =>
          Effect.sync(() => {
            if (windowId !== undefined) return;
            for (const listener of listeners.get(channel) ?? [])
              listener(payload);
          }),
        ),
        Effect.ignore,
        Effect.repeat(Schedule.spaced(250)),
      ),
    ),
  );
}
