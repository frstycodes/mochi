import sodium from 'libsodium-wrappers';
import { DEVICE_KINDS, type DeviceKind } from '../../src/host/types/remote.ts';
import type { DeviceKeys } from './crypto/keys.ts';
import { deviceId } from './pairing.ts';

/**
 * Membership of your computers (DEVICES.md › Pairing): each computer signs a record for every other computer it trusts,
 * and accepts a record only when its signer is one it already trusts, starting from its own key. The relay stores and
 * forwards these but holds no key, so it can drop records, not add a member.
 *
 * `member`: `addedBy` vouches for `publicKey`. Signed by the member itself it adds no trust; it only says what the member
 * calls itself and where the relay knows it (`machineId`).
 * `removal`: `removedBy` ends `deviceId`'s membership; a later `member` record from another computer brings it back.
 */
export type MemberRecord =
  | {
      type: 'member';
      deviceId: string;
      publicKey: string;
      machineId?: string;
      name: string;
      kind?: DeviceKind;
      addedBy: string;
      addedAt: number;
      signature: string;
    }
  | {
      type: 'removal';
      deviceId: string;
      removedBy: string;
      removedAt: number;
      signature: string;
    };

type Unsigned = MemberRecord extends infer R
  ? R extends MemberRecord
    ? Omit<R, 'signature'>
    : never
  : never;

export interface Member {
  deviceId: string;
  publicKey: string;
  /** Its id at the relay, from its own record; missing until it published one. */
  machineId?: string;
  name: string;
  kind?: DeviceKind;
  /** When this computer first trusted it, by the earliest record vouching for it. */
  addedAt: number;
  addedBy: string;
}

export interface Membership {
  /** Every computer this one trusts, itself included. */
  members: Map<string, Member>;
  /** A computer this one trusts removed it: it trusts nobody else until it joins again. */
  isRemoved: boolean;
}

const MAX_NAME = 64;
const MAX_RECORDS = 1000;
const DOMAIN = 'mochi-membership-v1\n';

/** The bytes a record's signature covers: a fixed field order, so both sides sign and check the same text. */
function signedBytes(record: Unsigned) {
  const fields =
    record.type === 'member'
      ? [
          record.type,
          record.deviceId,
          record.publicKey,
          record.machineId ?? '',
          record.name,
          record.kind ?? '',
          record.addedBy,
          record.addedAt,
        ]
      : [record.type, record.deviceId, record.removedBy, record.removedAt];
  return sodium.from_string(DOMAIN + JSON.stringify(fields));
}

const b64 = (bytes: Uint8Array) =>
  sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
const sign = (record: Unsigned, keys: DeviceKeys) =>
  b64(sodium.crypto_sign_detached(signedBytes(record), keys.privateKey));

/** `keys` vouches for `member`. Await `sodium.ready` first. */
export function signMember(
  keys: DeviceKeys,
  member: {
    publicKey: string;
    machineId?: string;
    name: string;
    kind?: DeviceKind;
  },
  addedAt: number,
): MemberRecord {
  const record = {
    type: 'member' as const,
    deviceId: deviceId(
      sodium.from_base64(member.publicKey, sodium.base64_variants.ORIGINAL),
    ),
    publicKey: member.publicKey,
    ...(member.machineId && { machineId: member.machineId }),
    name: member.name.trim().slice(0, MAX_NAME),
    ...(member.kind && { kind: member.kind }),
    addedBy: deviceId(keys.publicKey),
    addedAt,
  };
  return { ...record, signature: sign(record, keys) };
}

export function signRemoval(
  keys: DeviceKeys,
  removed: string,
  removedAt: number,
): MemberRecord {
  const record = {
    type: 'removal' as const,
    deviceId: removed,
    removedBy: deviceId(keys.publicKey),
    removedAt,
  };
  return { ...record, signature: sign(record, keys) };
}

const signerOf = (record: MemberRecord) =>
  record.type === 'member' ? record.addedBy : record.removedBy;
const timeOf = (record: MemberRecord) =>
  record.type === 'member' ? record.addedAt : record.removedAt;

/**
 * Who `self` trusts, from every record it holds, whoever sent them. Records whose signature doesn't check against their
 * signer's key are ignored, as are records signed by a key `self` doesn't trust: a chain must lead back to `self`.
 *
 * Removals apply in time order, each only if its signer wasn't removed before it, and only over the subject's records
 * from others older than it. Then trust is worked out again without the removed computers, as signers or as members;
 * every computer vouches for every member it trusts (`vouches`), so nobody depends on a removed one's records.
 */
export function resolveMembers(
  records: MemberRecord[],
  self: DeviceKeys,
): Membership {
  const selfId = deviceId(self.publicKey);
  const keys = new Map<string, Uint8Array>([[selfId, self.publicKey]]);
  for (const r of records) {
    const key = r.type === 'member' && memberKey(r);
    if (key) keys.set(r.deviceId, key);
  }
  const valid = records.filter((r) => isGenuine(r, keys));

  const reachable = closure(valid, selfId, new Set());
  const removed = new Set<string>();
  const removals = valid
    .filter((r) => r.type === 'removal' && reachable.has(r.removedBy))
    .sort((a, b) => timeOf(a) - timeOf(b));
  for (const removal of removals) {
    if (removed.has(signerOf(removal))) continue;
    const latestAdd = Math.max(
      -Infinity,
      ...valid
        .filter(
          (r) =>
            r.type === 'member' &&
            r.deviceId === removal.deviceId &&
            r.addedBy !== r.deviceId &&
            reachable.has(r.addedBy),
        )
        .map(timeOf),
    );
    if (timeOf(removal) >= latestAdd) removed.add(removal.deviceId);
  }
  if (removed.has(selfId))
    return {
      members: new Map([
        [selfId, profile(valid, selfId, self.publicKey, new Set([selfId]))],
      ]),
      isRemoved: true,
    };

  const trusted = closure(valid, selfId, removed);
  return {
    members: new Map(
      [...trusted].map((id) => [
        id,
        profile(valid, id, keys.get(id)!, trusted),
      ]),
    ),
    isRemoved: false,
  };
}

/** Keys reached from `selfId` through member records, skipping `removed` both as signers and as members. */
function closure(valid: MemberRecord[], selfId: string, removed: Set<string>) {
  const trusted = new Set([selfId]);
  for (let isGrowing = true; isGrowing;) {
    isGrowing = false;
    for (const r of valid) {
      if (
        r.type !== 'member' ||
        trusted.has(r.deviceId) ||
        removed.has(r.deviceId) ||
        removed.has(r.addedBy) ||
        !trusted.has(r.addedBy)
      )
        continue;
      trusted.add(r.deviceId);
      isGrowing = true;
    }
  }
  return trusted;
}

/** What a member calls itself: its newest record from a trusted signer, its own first. */
function profile(
  valid: MemberRecord[],
  id: string,
  publicKey: Uint8Array,
  trusted: Set<string>,
): Member {
  const about = valid.filter(
    (r): r is Extract<MemberRecord, { type: 'member' }> =>
      r.type === 'member' && r.deviceId === id && trusted.has(r.addedBy),
  );
  const newest = [...about].sort(
    (a, b) =>
      Number(b.addedBy === id) - Number(a.addedBy === id) ||
      b.addedAt - a.addedAt,
  )[0];
  const vouched = about
    .filter((r) => r.addedBy !== id)
    .sort((a, b) => a.addedAt - b.addedAt)[0];
  const machineId =
    about.find((r) => r.addedBy === id && r.machineId)?.machineId ??
    about.find((r) => r.machineId)?.machineId;
  return {
    deviceId: id,
    publicKey: b64(publicKey),
    ...(machineId && { machineId }),
    name: newest?.name ?? 'This computer',
    ...(newest?.kind && { kind: newest.kind }),
    addedAt: vouched?.addedAt ?? newest?.addedAt ?? 0,
    addedBy: vouched?.addedBy ?? id,
  };
}

/**
 * A member record's key, only when it is a real Ed25519 key whose derived id is the record's: a record naming someone
 * else's id with another key must not stand in for theirs, whatever order records arrive in.
 */
function memberKey(
  record: Extract<MemberRecord, { type: 'member' }>,
): Uint8Array | null {
  try {
    const key = sodium.from_base64(
      record.publicKey,
      sodium.base64_variants.ORIGINAL,
    );
    return key.length === sodium.crypto_sign_PUBLICKEYBYTES &&
      deviceId(key) === record.deviceId
      ? key
      : null;
  } catch {
    return null;
  }
}

/** The signature checks against the signer's key, and a member's id is the one its key derives. */
function isGenuine(record: MemberRecord, keys: Map<string, Uint8Array>) {
  const signer = keys.get(signerOf(record));
  if (!signer) return false;
  if (record.type === 'member' && !memberKey(record)) return false;
  const { signature, ...signed } = record;
  try {
    return sodium.crypto_sign_verify_detached(
      sodium.from_base64(signature, sodium.base64_variants.ORIGINAL),
      signedBytes(signed),
      signer,
    );
  } catch {
    return false;
  }
}

/**
 * The records `self` still has to sign: one for each member it trusts but hasn't vouched for, and its own, when it is
 * missing or says something else (`own`). Empty while removed: it vouches again once it joined again.
 */
export function vouches(
  records: MemberRecord[],
  membership: Membership,
  self: DeviceKeys,
  own: { machineId: string; name: string; kind?: DeviceKind },
  now: number,
): MemberRecord[] {
  if (membership.isRemoved) return [];
  const selfId = deviceId(self.publicKey);
  const signedHere = new Map(
    records
      .filter((r) => r.type === 'member' && r.addedBy === selfId)
      .map((r) => [r.deviceId, r as Extract<MemberRecord, { type: 'member' }>]),
  );
  const fresh: MemberRecord[] = [];
  for (const member of membership.members.values()) {
    if (member.deviceId === selfId || signedHere.has(member.deviceId)) continue;
    // Dated when it was first vouched for, not now: a computer that hasn't heard of a removal yet mustn't undo it.
    fresh.push(signMember(self, member, member.addedAt));
  }
  const mine = signedHere.get(selfId);
  if (
    !mine ||
    mine.machineId !== own.machineId ||
    mine.name !== own.name.trim().slice(0, MAX_NAME) ||
    mine.kind !== own.kind
  )
    fresh.push(
      signMember(self, { publicKey: b64(self.publicKey), ...own }, now),
    );
  return fresh;
}

/**
 * `keys` approved `member` on its own screen: dated now, or just after a removal it knows of, so joining again outranks
 * the removal whatever the clocks say.
 */
export function approveMember(
  records: MemberRecord[],
  keys: DeviceKeys,
  member: {
    publicKey: string;
    machineId?: string;
    name: string;
    kind?: DeviceKind;
  },
  now: number,
): MemberRecord {
  const id = deviceId(
    sodium.from_base64(member.publicKey, sodium.base64_variants.ORIGINAL),
  );
  const removedAt = Math.max(
    -Infinity,
    ...records
      .filter((r) => r.type === 'removal' && r.deviceId === id)
      .map(timeOf),
  );
  return signMember(keys, member, Math.max(now, removedAt + 1));
}

/** `incoming` folded into `held`: per kind, subject and signer only the newest record stays. `changed`: anything new. */
export function mergeRecords(
  held: MemberRecord[],
  incoming: MemberRecord[],
): { records: MemberRecord[]; changed: boolean } {
  const byKey = new Map(held.map((r) => [recordKey(r), r]));
  let changed = false;
  for (const record of incoming) {
    const existing = byKey.get(recordKey(record));
    if (existing && timeOf(existing) >= timeOf(record)) continue;
    byKey.set(recordKey(record), record);
    changed = true;
  }
  return { records: [...byKey.values()].slice(-MAX_RECORDS), changed };
}

export const recordKey = (record: MemberRecord) =>
  `${record.type}:${record.deviceId}:${signerOf(record)}`;

/** Records from the relay or another computer, shape only; `resolveMembers` decides what they're worth. */
export function parseRecords(value: unknown): MemberRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_RECORDS).flatMap((raw): MemberRecord[] => {
    const r = raw as Record<string, unknown>;
    if (!r || !isId(r.deviceId) || !isText(r.signature, 128)) return [];
    if (r.type === 'removal' && isId(r.removedBy) && isTime(r.removedAt))
      return [
        {
          type: 'removal',
          deviceId: r.deviceId,
          removedBy: r.removedBy,
          removedAt: r.removedAt,
          signature: r.signature,
        },
      ];
    if (
      r.type !== 'member' ||
      !isText(r.publicKey, 64) ||
      !isText(r.name, MAX_NAME) ||
      !isId(r.addedBy) ||
      !isTime(r.addedAt)
    )
      return [];
    if (r.machineId !== undefined && !isId(r.machineId)) return [];
    const kind = DEVICE_KINDS.includes(r.kind as never)
      ? (r.kind as DeviceKind)
      : undefined;
    return [
      {
        type: 'member',
        deviceId: r.deviceId,
        publicKey: r.publicKey,
        ...(r.machineId !== undefined && { machineId: r.machineId as string }),
        name: r.name,
        ...(kind && { kind }),
        addedBy: r.addedBy,
        addedAt: r.addedAt,
        signature: r.signature,
      },
    ];
  });
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const isTime = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
