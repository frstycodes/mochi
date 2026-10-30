import { createSocket, type RemoteInfo } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { Option, Schema } from 'effect';
import { RelayWire } from '@mochi/schema';
import { isPrivate } from './interfaces.ts';
import { formatAddress } from './routes.ts';

/** The UDP port every Mochi listens on for its other computers on the network. `MOCHI_NEARBY_PORT` for a dev run beside an installed one. */
export const NEARBY_PORT = Number(process.env.MOCHI_NEARBY_PORT) || 47372;
const ANNOUNCE_MS = 5000;
/** Three announcements missed: it left the network. */
const STALE_MS = 3 * ANNOUNCE_MS + 1000;
const MAX_DATAGRAM_BYTES = 512;

/**
 * What a computer broadcasts on its network every few seconds: enough to dial it and to match it against the relay's
 * listing and your members, and nothing more. No name: names are sealed from the relay too (DEVICES.md › Encryption inventory).
 */
const Announcement = Schema.Struct({
  mochi: Schema.Literal(1),
  id: RelayWire.RelayId,
  publicKey: RelayWire.PublicKey,
  port: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: 65_535 }),
  ),
});
export type Announcement = Omit<typeof Announcement.Type, 'mochi'>;
const decodeAnnouncement = Schema.decodeUnknownOption(
  Schema.fromJsonString(Announcement),
);

/** A computer heard on this network. `address` is where it was heard from with its port: the payload never names a host. */
export interface NearbyComputer extends Announcement {
  address: string;
  seenAt: number;
}

export const encodeAnnouncement = (announcement: Announcement) =>
  Buffer.from(JSON.stringify({ mochi: 1, ...announcement }));

/** One datagram as a nearby computer; undefined for anything malformed, from beyond a private network, or this computer's own. */
export function parseAnnouncement(
  bytes: Uint8Array,
  from: Pick<RemoteInfo, 'address' | 'family'>,
  ownKey: string,
  now = Date.now(),
): NearbyComputer | undefined {
  if (bytes.length > MAX_DATAGRAM_BYTES) return undefined;
  if (!isPrivate(from.address, from.family)) return undefined;
  const decoded = Option.getOrUndefined(
    decodeAnnouncement(Buffer.from(bytes).toString('utf8')),
  );
  if (!decoded || decoded.publicKey === ownKey) return undefined;
  const { id, publicKey, port } = decoded;
  return {
    id,
    publicKey,
    port,
    address: formatAddress({ host: from.address, port }),
    seenAt: now,
  };
}

/** Each private IPv4 network's broadcast address. A /32 (Tailscale, point-to-point links) has none; its members dial sealed candidates. */
export function broadcastAddresses(interfaces = networkInterfaces()) {
  const addresses = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter(
      (a) =>
        a.family === 'IPv4' &&
        !a.internal &&
        a.netmask !== '255.255.255.255' &&
        isPrivate(a.address, a.family),
    )
    .map((a) => {
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      return ip.map((octet, i) => (octet | ~mask[i]!) & 255).join('.');
    });
  return [...new Set(addresses)];
}

export interface NearbyOptions {
  announcement: () => Announcement;
  /** When a computer appears, moves or leaves. */
  onChange: () => void;
  onError: (error: Error) => void;
  port?: number;
}

export type Nearby = ReturnType<typeof startNearby>;

/**
 * Finds your computers on this network without the relay: broadcasts this computer's announcement to each private network
 * every few seconds and keeps what it hears from the others. Hearing one proves nothing: a member's key is checked by the
 * pairing handshake on every dial, and a join over the LAN by the relay's listing (`secureAsMachine`).
 */
export function startNearby({
  announcement,
  onChange,
  onError,
  port = NEARBY_PORT,
}: NearbyOptions) {
  const heard = new Map<string, NearbyComputer>();
  // Another Mochi on this computer (a dev run) may listen on the port too.
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  let isClosed = false;
  // The port taken, or the network refused the socket: no discovery until remote access restarts; the relay still works.
  socket.on('error', (error) => {
    close();
    onError(error);
  });
  socket.on('message', (bytes, from) => {
    const found = parseAnnouncement(bytes, from, announcement().publicKey);
    if (!found) return;
    const before = heard.get(found.publicKey);
    heard.set(found.publicKey, found);
    if (before?.address !== found.address || before.id !== found.id) onChange();
  });
  function prune() {
    const cutoff = Date.now() - STALE_MS;
    let isChanged = false;
    for (const [key, computer] of heard)
      if (computer.seenAt < cutoff) isChanged = heard.delete(key);
    if (isChanged) onChange();
  }
  function announce() {
    prune();
    const bytes = encodeAnnouncement(announcement());
    // A network that refuses a broadcast (no route, client isolation) just hears nothing.
    for (const to of broadcastAddresses())
      socket.send(bytes, port, to, () => {});
  }
  socket.bind(port, () => {
    socket.setBroadcast(true);
    announce();
  });
  const timer = setInterval(announce, ANNOUNCE_MS);
  timer.unref();
  function close() {
    if (isClosed) return;
    isClosed = true;
    clearInterval(timer);
    socket.close();
  }
  return { computers: () => [...heard.values()], close };
}

/** A computer that could join, from the relay's listing or heard on this network. `address` when heard. */
export interface Joinable {
  id: string;
  publicKey: string;
  isOnline: boolean;
  isNearby: boolean;
  address?: string;
  listed?: RelayWire.RelayMachine;
}

/**
 * The relay's listing and the computers heard nearby as one list, one entry per key. Heard means online, whatever the relay
 * last saw. One heard under a listed id with another key is dropped: the listing is the account's, the announcement anyone's.
 */
export function mergeNearby(
  listed: readonly RelayWire.RelayMachine[],
  nearby: readonly NearbyComputer[],
): Joinable[] {
  const near = new Map(nearby.map((c) => [c.publicKey, c]));
  const fromRelay = listed.map((machine): Joinable => {
    const heard = near.get(machine.publicKey);
    return {
      id: machine.id,
      publicKey: machine.publicKey,
      isOnline: machine.isOnline || !!heard,
      isNearby: !!heard,
      ...(heard && { address: heard.address }),
      listed: machine,
    };
  });
  const onlyNearby = nearby
    .filter(
      (c, i) =>
        !listed.some((m) => m.publicKey === c.publicKey || m.id === c.id) &&
        nearby.findIndex((other) => other.id === c.id) === i,
    )
    .map((c): Joinable => ({
      id: c.id,
      publicKey: c.publicKey,
      isOnline: true,
      isNearby: true,
      address: c.address,
    }));
  return [...fromRelay, ...onlyNearby];
}
