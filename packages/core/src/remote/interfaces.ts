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
