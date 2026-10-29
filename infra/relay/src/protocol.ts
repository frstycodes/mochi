// The relay's frames are schemas in `packages/schema` (`relayWire.ts`), shared with the machines and devices that speak them.
export {
  CLOSE,
  HEARTBEAT,
  isId,
  MAX_FRAME_BYTES,
  splitChannel,
  withChannel,
  type MachineFrame,
  type RelayToMachine,
} from '../../../packages/schema/src/relayWire.ts';
export type Sealed = Record<string, string>;
import {
  decodeMachineFrame,
  isId,
} from '../../../packages/schema/src/relayWire.ts';

export const parseMachineFrame = (raw: string) =>
  decodeMachineFrame(raw) ?? null;

/**
 * A signed membership record as the relay keeps it (`packages/core/src/remote/members.ts`). The relay holds no key and
 * checks no signature: it keeps the newest record per kind, subject and signer, and each computer decides what a record
 * is worth. A member record's name and kind are `sealed` to the members (`sealed.ts`); one carrying them in clear is
 * refused, so nothing the relay stores names a computer.
 */
export type StoredRecord = {
  type: 'member' | 'removal';
  deviceId: string;
  signer: string;
  at: number;
  record: Record<string, unknown>;
};

/** A sealed box per member (up to `MAX_SEALED_MEMBERS`) and the public fields. */
const MAX_RECORD_CHARS = 16384;
export const MAX_RECORDS = 1000;

/** A `POST /v1/members` body: an array of records. Off-shape entries are dropped, never stored. */
export function parseRecords(value: unknown): StoredRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_RECORDS).flatMap((raw) => {
    const r = raw as Record<string, unknown>;
    if (
      !r ||
      typeof r !== 'object' ||
      JSON.stringify(r).length > MAX_RECORD_CHARS ||
      !isId(r.deviceId)
    )
      return [];
    const signer =
      r.type === 'member'
        ? r.addedBy
        : r.type === 'removal'
          ? r.removedBy
          : undefined;
    const at = r.type === 'member' ? r.addedAt : r.removedAt;
    if (
      !isId(signer) ||
      !Number.isSafeInteger(at) ||
      typeof r.signature !== 'string'
    )
      return [];
    if (
      r.type === 'member' &&
      ('name' in r || 'kind' in r || !r.sealed || typeof r.sealed !== 'object')
    )
      return [];
    return [
      {
        type: r.type as StoredRecord['type'],
        deviceId: r.deviceId,
        signer,
        at: at as number,
        record: r,
      },
    ];
  });
}

export const storedKey = (
  r: Pick<StoredRecord, 'type' | 'deviceId' | 'signer'>,
) => `${r.type}:${r.deviceId}:${r.signer}`;
