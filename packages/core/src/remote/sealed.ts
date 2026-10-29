import sodium from 'libsodium-wrappers';
import { RelayWire } from '@mochi/schema';
import { deviceId } from './pairing.ts';
import type { MemberRecord } from './members.ts';
import type { DeviceKeys } from './session.ts';
import {
  DEVICE_KINDS,
  type DeviceKind,
} from '../../../../apps/desktop/src/host/types/remote.ts';

/**
 * What the relay keeps beyond routing (a machine's name, kind and addresses, the names in membership records) is sealed to
 * each member's key, so the relay stores ciphertext (DEVICES.md › End-to-end encryption). One libsodium sealed box per
 * member, keyed by its `deviceId`: a member opens its own entry with its device key, and nobody else can, the relay and a
 * computer that hasn't joined yet included. Await `sodium.ready` before any of these.
 */
export type Sealed = Record<string, string>;

export function sealTo(value: unknown, publicKeys: Uint8Array[]): Sealed {
  const plain = sodium.from_string(JSON.stringify(value));
  const sealed: Sealed = {};
  for (const publicKey of publicKeys.slice(0, RelayWire.MAX_SEALED_MEMBERS))
    sealed[deviceId(publicKey)] ??= b64(
      sodium.crypto_box_seal(
        plain,
        sodium.crypto_sign_ed25519_pk_to_curve25519(publicKey),
      ),
    );
  return sealed;
}

/** This key's entry, opened and parsed; undefined when there is none or it doesn't open. */
export function openSealed(sealed: unknown, keys: DeviceKeys): unknown {
  if (!sealed || typeof sealed !== 'object') return undefined;
  const entry = (sealed as Record<string, unknown>)[deviceId(keys.publicKey)];
  if (typeof entry !== 'string') return undefined;
  try {
    return JSON.parse(
      sodium.to_string(
        sodium.crypto_box_seal_open(
          sodium.from_base64(entry, sodium.base64_variants.ORIGINAL),
          sodium.crypto_sign_ed25519_pk_to_curve25519(keys.publicKey),
          sodium.crypto_sign_ed25519_sk_to_curve25519(keys.privateKey),
        ),
      ),
    ) as unknown;
  } catch {
    return undefined;
  }
}

export interface MachineAddress {
  host: string;
  port: number;
  via: 'lan' | 'tailscale';
}

/** A machine as its members see it in the relay's listing; the relay sees only the sealed map. */
export interface MachineInfo {
  name: string;
  kind: DeviceKind;
  addresses: MachineAddress[];
  updatedAt: number;
}

/** Sealed for the `register` frame, to every member including this machine, so it can read its own entry. */
export const sealMachineInfo = (
  info: MachineInfo,
  memberPublicKeys: Uint8Array[],
): Sealed => sealTo(info, memberPublicKeys);

/** A listed machine's info for this key, or undefined when it wasn't sealed to it or doesn't decode. */
export function openMachineInfo(
  machine: { sealed?: Sealed },
  keys: DeviceKeys,
): MachineInfo | undefined {
  const info = openSealed(machine.sealed, keys) as Partial<MachineInfo>;
  if (
    !info ||
    typeof info.name !== 'string' ||
    !DEVICE_KINDS.includes(info.kind as never) ||
    !Array.isArray(info.addresses) ||
    typeof info.updatedAt !== 'number'
  )
    return undefined;
  return {
    name: info.name,
    kind: info.kind!,
    addresses: info.addresses.filter(
      (a): a is MachineAddress =>
        typeof a?.host === 'string' &&
        Number.isInteger(a.port) &&
        (a.via === 'lan' || a.via === 'tailscale'),
    ),
    updatedAt: info.updatedAt,
  };
}

const b64 = (bytes: Uint8Array) =>
  sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

/**
 * Member records as the relay keeps them: the name and kind sealed to the members, the rest (ids, public key, dates,
 * signature) public, since the relay indexes by them and anyone may check a signature. `openRecords` puts the name and
 * kind back before `parseRecords` checks the signature; a record this key can't open is dropped, and arrives over a link.
 */
export function sealRecords(
  records: readonly MemberRecord[],
  memberPublicKeys: Uint8Array[],
): unknown[] {
  return records.map((record) => {
    if (record.type !== 'member') return record;
    const { name, kind, ...rest } = record;
    return { ...rest, sealed: sealTo({ name, kind }, memberPublicKeys) };
  });
}

export function openRecords(listed: unknown, keys: DeviceKeys): unknown[] {
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((raw: unknown) => {
    const record = raw as Record<string, unknown> | null;
    if (!record || typeof record !== 'object' || !('sealed' in record))
      return [record];
    const about = openSealed(record.sealed, keys) as {
      name?: unknown;
      kind?: unknown;
    } | null;
    if (!about || typeof about.name !== 'string') return [];
    const { sealed: _, ...rest } = record;
    return [
      {
        ...rest,
        name: about.name,
        ...(typeof about.kind === 'string' && { kind: about.kind }),
      },
    ];
  });
}
