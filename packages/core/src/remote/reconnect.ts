import { Effect } from 'effect';

const MAX_DELAY_MS = 30_000;
const listeners = new Set<() => void>();

/** The network came back or changed (an address came or went, the computer woke): every redial waiting out its backoff goes now. */
export function networkChanged() {
  for (const listener of listeners) listener();
}

export function onNetworkChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * How a device redials a machine (LAN and relay alike) and how a machine redials the relay: before the `attempt`th redial
 * (from 1), 1s doubling to 30s, jittered by ±20% so computers that lost the same relay don't all come back in the same
 * instant. A network change cuts the wait short.
 */
export const backoff = (attempt: number) =>
  Effect.callback<void>((resume) => {
    const ms = Math.min(1000 * 2 ** (attempt - 1), MAX_DELAY_MS);
    const done = () => {
      off();
      clearTimeout(timer);
      resume(Effect.void);
    };
    const timer = setTimeout(done, ms * (0.8 + Math.random() * 0.4));
    const off = onNetworkChange(done);
    return Effect.sync(() => {
      off();
      clearTimeout(timer);
    });
  });
