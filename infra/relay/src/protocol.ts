/**
 * The relay's own frames (DEVICES.md › Transport). Everything a machine and a device say to each other is end-to-end
 * encrypted binary the relay forwards untouched; only these small JSON control frames are the relay's.
 *
 * Machine socket: binary frames carry a 4-byte big-endian channel number, then the device's bytes. Text frames are
 * control: the machine sends `register` and `close`, the relay sends `open` and `close`.
 * Device socket: binary frames are the bytes, unprefixed: a device talks to exactly one machine.
 */
export type MachineFrame = { type: 'register'; name: string; publicKey: string } | { type: 'close'; channel: number };

/** `members`: the account's signed membership records changed; fetch them again (`GET /v1/members`). */
export type RelayToMachine = { type: 'open'; channel: number; deviceId: string } | { type: 'close'; channel: number } | { type: 'members' };

/** Text frames either side may send to keep a socket provably alive; the relay's runtime answers them itself. */
export const HEARTBEAT = { ping: 'ping', pong: 'pong' } as const;

export const MAX_FRAME_BYTES = 1024 * 1024;
const CHANNEL_BYTES = 4;
const MAX_NAME = 64;
const ED25519_PUBLIC_KEY_BYTES = 32;

/** Close codes a client can act on. */
export const CLOSE = {
  unsupported: 1003,
  tooBig: 1009,
  machineOffline: 4404,
  replaced: 4409,
  badFrame: 4400,
} as const;

/** Ids are the clients' own (a machine's install id, a device's key id): short, URL-safe, never secret. */
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export function parseMachineFrame(raw: string): MachineFrame | null {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (frame?.type === 'close') return isChannel(frame.channel) ? { type: 'close', channel: frame.channel } : null;
  if (frame?.type !== 'register') return null;
  const { name, publicKey } = frame;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) return null;
  if (typeof publicKey !== 'string' || base64Length(publicKey) !== ED25519_PUBLIC_KEY_BYTES) return null;
  return { type: 'register', name: name.trim(), publicKey };
}

export function withChannel(channel: number, bytes: Uint8Array): Uint8Array {
  const framed = new Uint8Array(CHANNEL_BYTES + bytes.length);
  new DataView(framed.buffer).setUint32(0, channel);
  framed.set(bytes, CHANNEL_BYTES);
  return framed;
}

export function splitChannel(framed: Uint8Array): { channel: number; bytes: Uint8Array } | null {
  if (framed.length < CHANNEL_BYTES) return null;
  return { channel: new DataView(framed.buffer, framed.byteOffset).getUint32(0), bytes: framed.subarray(CHANNEL_BYTES) };
}

const isChannel = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;

function base64Length(text: string): number {
  try {
    return atob(text).length;
  } catch {
    return -1;
  }
}

/**
 * A signed membership record as the relay keeps it (`electron/remote/members.ts`). The relay holds no key and checks no
 * signature: it keeps the newest record per kind, subject and signer, and each computer decides what a record is worth.
 */
export type StoredRecord = { type: 'member' | 'removal'; deviceId: string; signer: string; at: number; record: Record<string, unknown> };

const MAX_RECORD_CHARS = 2048;
export const MAX_RECORDS = 1000;

/** A `POST /v1/members` body: an array of records. Off-shape entries are dropped, never stored. */
export function parseRecords(value: unknown): StoredRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_RECORDS).flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r !== 'object' || JSON.stringify(r).length > MAX_RECORD_CHARS || !isId(r.deviceId)) return [];
    const signer = r.type === 'member' ? r.addedBy : r.type === 'removal' ? r.removedBy : undefined;
    const at = r.type === 'member' ? r.addedAt : r.removedAt;
    if (!isId(signer) || !Number.isSafeInteger(at) || typeof r.signature !== 'string') return [];
    return [{ type: r.type as StoredRecord['type'], deviceId: r.deviceId, signer, at: at as number, record: r }];
  });
}

export const storedKey = (r: Pick<StoredRecord, 'type' | 'deviceId' | 'signer'>) => `${r.type}:${r.deviceId}:${r.signer}`;
