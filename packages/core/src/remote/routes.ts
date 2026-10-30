import { Effect } from 'effect';
import type { RelayWire } from '@mochi/schema';
import { openLan, type Route, type Routes } from './device.ts';
import { isPrivate } from './interfaces.ts';
import { listMachines } from './relayClient.ts';
import { openMachineInfo, type MachineAddress } from './sealed.ts';
import type { DeviceKeys } from './session.ts';

/** How long the relay's listing may take before dialling goes ahead with the addresses already known. */
const LISTING_TIMEOUT_MS = 3000;

/** `host:port`, IPv6 in brackets, as the server reports its own and `openLan` dials. */
export const formatAddress = ({
  host,
  port,
}: Pick<MachineAddress, 'host' | 'port'>) =>
  host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;

/** A bound `host:port` as a sealed candidate; loopback and public addresses are never one. */
export function asCandidate(address: string): MachineAddress | undefined {
  const match = /^\[?([^\]]+)\]?:(\d+)$/.exec(address);
  if (!match) return undefined;
  const [, host, port] = match as unknown as [string, string, string];
  const family = host.includes(':') ? 'IPv6' : 'IPv4';
  if (!isPrivate(host, family)) return undefined;
  return {
    host,
    port: Number(port),
    via: isTailscale(host) ? 'tailscale' : 'lan',
  };
}

/** Tailscale's CGNAT range, 100.64/10, and its IPv6 prefix. */
function isTailscale(host: string) {
  if (/^fd7a:115c:a1e0:/i.test(host)) return true;
  const [a, b] = host.split('.').map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
}

export interface RoutesToOptions {
  machineId: string;
  /** What its last welcome listed, kept with the paired machine. */
  known: readonly string[];
  token: () => Promise<string>;
  keys: () => Promise<DeviceKeys>;
  /** The relay route, when signed in. */
  relay?: Route;
  /** The relay's listing, for tests; `listMachines` by default. */
  list?: (token: string) => Promise<readonly RelayWire.RelayMachine[]>;
}

/**
 * Every way to reach a machine right now: its addresses as the relay holds them (sealed to this computer, so the relay never
 * read them) together with the ones its last welcome listed, dialled together, then the relay. Asked before every dial, so the
 * first connection, and one after either side changed networks, tries direct first. A listing that fails or is slow only
 * means the known addresses are dialled.
 */
export async function routesTo(options: RoutesToOptions): Promise<Routes> {
  const listed = await listing(options);
  const info = listed && openMachineInfo(listed, await options.keys());
  const addresses = new Set([
    ...(info?.addresses.map(formatAddress) ?? []),
    ...options.known,
  ]);
  return {
    direct: [...addresses].map((address): Route => ({
      kind: 'lan',
      open: () => openLan(address),
    })),
    ...(options.relay && { relay: options.relay }),
    isSameSite: listed?.sameSite === true,
  };
}

async function listing(options: RoutesToOptions) {
  const list = options.list ?? listMachines;
  const machines = await Effect.runPromise(
    Effect.tryPromise(async () => list(await options.token())).pipe(
      Effect.timeout(LISTING_TIMEOUT_MS),
      Effect.orElseSucceed(() => undefined),
    ),
  );
  return machines?.find((m) => m.id === options.machineId);
}
