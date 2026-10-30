import { Option, Schema, SchemaTransformation } from 'effect';
import { Int, Str } from './checks.ts';

// Imported by the relay worker (`infra/relay`) as well as by Mochi: nothing here may pull in more than `effect`.

/**
 * The relay's own frames (DEVICES.md › Transport). Everything a machine and a device say to each other is end-to-end
 * encrypted binary the relay forwards untouched; only these small JSON control frames are the relay's.
 *
 * Machine socket: binary frames carry a 4-byte big-endian channel number, then the device's bytes. Text frames are
 * control: the machine sends `register` (again whenever its members or addresses change) and `close`, the relay sends
 * `open`, `close` and `members`.
 *
 * What the relay keeps beyond routing (the id and public key) is `sealed`: one libsodium sealed box per member, keyed by
 * its device id (`packages/core/src/remote/sealed.ts`). The relay stores and returns it, and can read none of it.
 * Device socket: binary frames are the bytes, unprefixed: a device talks to exactly one machine.
 */

/** Text frames either side may send to keep a socket provably alive; the relay's runtime answers them itself. */
export const HEARTBEAT = { ping: 'ping', pong: 'pong' } as const;

export const MAX_FRAME_BYTES = 1024 * 1024;
const CHANNEL_BYTES = 4;
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
export const RelayId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/),
);
export const isId = Schema.is(RelayId);

const Channel = Int.check(
  Schema.isBetween({ minimum: 0, maximum: 0xffffffff }),
);
const Name = Str(64)
  .check(Schema.makeFilter((s: string) => !!s.trim() || 'must not be blank'))
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim()));
/** A sealed box per member, keyed by device id; the relay holds no key that opens one. */
export const MAX_SEALED_MEMBERS = 64;
export const Sealed = Schema.Record(RelayId, Str(4096)).check(
  Schema.makeFilter(
    (sealed: Record<string, string>) =>
      Object.keys(sealed).length <= MAX_SEALED_MEMBERS ||
      `at most ${MAX_SEALED_MEMBERS} members`,
  ),
);
export const PublicKey = Schema.String.check(
  Schema.makeFilter(
    (s: string) =>
      base64Length(s) === ED25519_PUBLIC_KEY_BYTES ||
      'must be an Ed25519 public key, base64',
  ),
);

export const MachineFrame = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('register'),
    publicKey: PublicKey,
    sealed: Schema.optional(Sealed),
    /** Before 2026-10: the name in clear. Still accepted from older machines; never sent now. */
    name: Schema.optional(Name),
  }),
  Schema.Struct({ type: Schema.Literal('close'), channel: Channel }),
]);
export type MachineFrame = typeof MachineFrame.Type;

/** `members`: the account's signed membership records changed; fetch them again (`GET /v1/members`). */
export const RelayToMachine = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('open'),
    channel: Channel,
    deviceId: RelayId,
  }),
  Schema.Struct({ type: Schema.Literal('close'), channel: Channel }),
  Schema.Struct({ type: Schema.Literal('members') }),
]);
export type RelayToMachine = typeof RelayToMachine.Type;

/**
 * One computer on the account, as `GET /v1/machines` lists it. `sameSite`: the asking device and the machine's socket
 * reach the relay from the same IP, which the relay compares without returning either.
 */
export const RelayMachine = Schema.Struct({
  id: RelayId,
  publicKey: PublicKey,
  isOnline: Schema.Boolean,
  sealed: Schema.optional(Sealed),
  sameSite: Schema.optional(Schema.Boolean),
  /** From an older machine that registered its name in clear. */
  name: Schema.optional(Schema.String),
});
export type RelayMachine = typeof RelayMachine.Type;

const machineFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(MachineFrame),
);
const relayToMachine = Schema.decodeUnknownOption(
  Schema.fromJsonString(RelayToMachine),
);

/** A machine's text frame on the relay, or `undefined` when it isn't one. */
export const decodeMachineFrame = (raw: string) =>
  Option.getOrUndefined(machineFrame(raw));

/** The relay's text frame on the machine, or `undefined` when it isn't one. */
export const decodeRelayToMachine = (raw: string) =>
  Option.getOrUndefined(relayToMachine(raw));

export function withChannel(channel: number, bytes: Uint8Array): Uint8Array {
  const framed = new Uint8Array(CHANNEL_BYTES + bytes.length);
  new DataView(framed.buffer).setUint32(0, channel);
  framed.set(bytes, CHANNEL_BYTES);
  return framed;
}

export function splitChannel(
  framed: Uint8Array,
): { channel: number; bytes: Uint8Array } | null {
  if (framed.length < CHANNEL_BYTES) return null;
  return {
    channel: new DataView(framed.buffer, framed.byteOffset).getUint32(0),
    bytes: framed.subarray(CHANNEL_BYTES),
  };
}

function base64Length(text: string): number {
  try {
    return atob(text).length;
  } catch {
    return -1;
  }
}
