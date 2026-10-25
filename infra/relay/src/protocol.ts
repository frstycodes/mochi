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
import {
  decodeMachineFrame,
  isId,
} from '../../../packages/schema/src/relayWire.ts';

export const parseMachineFrame = (raw: string) =>
  decodeMachineFrame(raw) ?? null;

/**
 * A signed membership record as the relay keeps it (`electron/remote/members.ts`). The relay holds no key and checks no
 * signature: it keeps the newest record per kind, subject and signer, and each computer decides what a record is worth.
 */
export type StoredRecord = {
  type: 'member' | 'removal';
  deviceId: string;
  signer: string;
  at: number;
  record: Record<string, unknown>;
};

const MAX_RECORD_CHARS = 2048;
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
