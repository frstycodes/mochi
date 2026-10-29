import { networkInterfaces } from 'node:os';

/** This machine's LAN and Tailscale addresses: private IPv4, Tailscale's 100.64/10, and unique-local IPv6. Never public ones. */
export function networkHosts(interfaces = networkInterfaces()): string[] {
  return Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((a) => !a.internal && isPrivate(a.address, a.family))
    .map((a) => a.address);
}

export function isPrivate(address: string, family: string) {
  if (family === 'IPv6') return /^f[cd][0-9a-f]{2}:/i.test(address);
  const [a, b] = address.split('.').map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

const WATCH_MS = 3000;
/** A tick this much later than due means the computer slept: its sockets are likely dead even on the same addresses. */
const SLEPT_MS = 10_000;

/**
 * Polls this computer's addresses every few seconds and calls `onChange` when one came or went, or when it woke from sleep.
 * Node has no network events; Electron's `powerMonitor` adds its own on top of this.
 */
export function watchNetwork(
  onChange: () => void,
  hosts: () => string[] = networkHosts,
) {
  let last = hosts().sort().join(' ');
  let due = Date.now() + WATCH_MS;
  const timer = setInterval(() => {
    const now = Date.now();
    const next = hosts().sort().join(' ');
    const hasSlept = now - due > SLEPT_MS;
    due = now + WATCH_MS;
    if (next === last && !hasSlept) return;
    last = next;
    onChange();
  }, WATCH_MS);
  timer.unref();
  return () => clearInterval(timer);
}
