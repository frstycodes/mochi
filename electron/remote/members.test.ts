import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import sodium from 'libsodium-wrappers';
import type { DeviceKeys } from './crypto/keys.ts';
import { approveMember, mergeRecords, parseRecords, resolveMembers, signMember, signRemoval, vouches, type MemberRecord } from './members.ts';
import { deviceId } from './pairing.ts';

await sodium.ready;

const keypair = (): DeviceKeys => sodium.crypto_sign_keypair();
const b64 = (bytes: Uint8Array) => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
const as = (keys: DeviceKeys, name: string) => ({ publicKey: b64(keys.publicKey), name, machineId: `m-${name}` });
const idOf = (keys: DeviceKeys) => deviceId(keys.publicKey);
const trusts = (records: MemberRecord[], self: DeviceKeys) => [...resolveMembers(records, self).members.keys()].sort();

test('a record signed by a member this computer trusts is accepted', () => {
  const [a, b] = [keypair(), keypair()];
  assert.deepEqual(trusts([signMember(a, as(b, 'B'), 1)], a), [idOf(a), idOf(b)].sort());
  assert.equal(resolveMembers([signMember(a, as(b, 'B'), 1)], a).members.get(idOf(b))?.machineId, 'm-B');
});

test('a record signed by an unknown key, or tampered with, is refused', () => {
  const [a, b, stranger] = [keypair(), keypair(), keypair()];
  assert.deepEqual(trusts([signMember(stranger, as(b, 'B'), 1)], a), [idOf(a)]);

  const genuine = signMember(a, as(b, 'B'), 1) as Extract<MemberRecord, { type: 'member' }>;
  const swappedKey = { ...genuine, publicKey: b64(stranger.publicKey), deviceId: idOf(stranger) };
  assert.deepEqual(trusts([swappedKey], a), [idOf(a)]);
  assert.deepEqual(trusts([{ ...genuine, name: 'Renamed' }], a), [idOf(a)]);
  assert.deepEqual(trusts([{ ...genuine, signature: genuine.signature.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }], a), [idOf(a)]);
});

test('a record naming someone’s id with another key, or a broken key, changes nothing, whatever order it arrives in', () => {
  const [a, b, c, stranger] = [keypair(), keypair(), keypair(), keypair()];
  const genuine = [signMember(a, as(b, 'B'), 1), signMember(b, as(c, 'C'), 2)];
  const poison = { ...(signMember(stranger, as(stranger, 'B'), 0) as Extract<MemberRecord, { type: 'member' }>), deviceId: idOf(b) };
  const broken = { ...poison, publicKey: 'not base64!' };
  assert.deepEqual(trusts([poison, broken, ...genuine], a), [idOf(a), idOf(b), idOf(c)].sort());
  assert.deepEqual(trusts([...genuine, broken, poison], a), [idOf(a), idOf(b), idOf(c)].sort());
});

test('a chain A→B→C is accepted by A, and by C back to A once C vouched for B', () => {
  const [a, b, c] = [keypair(), keypair(), keypair()];
  const records = [signMember(a, as(b, 'B'), 1), signMember(b, as(c, 'C'), 2)];
  assert.deepEqual(trusts(records, a), [idOf(a), idOf(b), idOf(c)].sort());
  // C approved B on its own screen, so it signs for B; B's record for A then reaches A.
  const fromC = [...records, signMember(c, as(b, 'B'), 2), signMember(b, as(a, 'A'), 1)];
  assert.deepEqual(trusts(fromC, c), [idOf(a), idOf(b), idOf(c)].sort());
});

test('a removal ends trust everywhere, and a later approval brings the computer back', () => {
  const [a, b, c] = [keypair(), keypair(), keypair()];
  const joined = [signMember(a, as(b, 'B'), 1), signMember(b, as(c, 'C'), 2), signMember(a, as(c, 'C'), 3), signMember(c, as(a, 'A'), 3)];
  const removed = [...joined, signRemoval(a, idOf(b), 10)];
  assert.deepEqual(trusts(removed, a), [idOf(a), idOf(c)].sort());
  assert.deepEqual(trusts(removed, c), [idOf(a), idOf(c)].sort());
  assert.equal(resolveMembers(removed, b).isRemoved, true);
  assert.deepEqual(trusts(removed, b), [idOf(b)]);

  // B can't vouch itself back, nor remove anyone after it was removed.
  assert.deepEqual(trusts([...removed, signMember(b, as(b, 'B'), 20), signRemoval(b, idOf(c), 21)], a), [idOf(a), idOf(c)].sort());
  // Joining again: a member's new record, newer than the removal.
  assert.deepEqual(trusts([...removed, approveMember(removed, c, as(b, 'B'), 3)], a), [idOf(a), idOf(b), idOf(c)].sort());
});

test('a computer that hadn’t heard of a removal vouches with the old date, so the removal still wins', () => {
  const [a, b, d] = [keypair(), keypair(), keypair()];
  const beforeRemoval = [signMember(a, as(b, 'B'), 1), signMember(a, as(d, 'D'), 1), signMember(d, as(a, 'A'), 1)];
  const lateVouch = vouches(beforeRemoval, resolveMembers(beforeRemoval, d), d, { machineId: 'm-D', name: 'D' }, 50);
  assert.deepEqual(trusts([...beforeRemoval, ...lateVouch, signRemoval(a, idOf(b), 10)], a), [idOf(a), idOf(d)].sort());
});

test('the relay can’t forge a member: it holds no member key, and replaying or dropping records adds nobody', () => {
  const [a, b] = [keypair(), keypair()];
  const relay = keypair();
  const forged: MemberRecord[] = [
    // Signed with its own key, naming itself as signer or as a member.
    signMember(relay, as(relay, 'Relay'), 1),
    { ...(signMember(relay, as(relay, 'Relay'), 1) as Extract<MemberRecord, { type: 'member' }>), addedBy: idOf(a) },
    // Unsigned.
    { type: 'member', deviceId: idOf(relay), publicKey: b64(relay.publicKey), name: 'Relay', addedBy: idOf(a), addedAt: 1, signature: b64(new Uint8Array(64)) },
  ];
  assert.deepEqual(trusts([signMember(a, as(b, 'B'), 1), ...forged], a), [idOf(a), idOf(b)].sort());
  // Replaying B's old record after its removal doesn't bring it back.
  const old = signMember(a, as(b, 'B'), 1);
  assert.deepEqual(trusts([old, signRemoval(a, idOf(b), 5), old], a), [idOf(a)]);
  // A removal it signed itself is ignored.
  assert.deepEqual(trusts([old, signRemoval(relay, idOf(b), 5)], a), [idOf(a), idOf(b)].sort());
});

test('every member is vouched for once, and merging keeps one newest record per signer and subject', () => {
  const [a, b, c] = [keypair(), keypair(), keypair()];
  const records = [signMember(a, as(b, 'B'), 1), signMember(b, as(c, 'C'), 2)];
  const own = { machineId: 'm-A', name: 'A' };
  const fresh = vouches(records, resolveMembers(records, a), a, own, 5);
  assert.deepEqual(fresh.map((r) => `${r.deviceId}<${r.type === 'member' && r.addedBy}`).sort(), [`${idOf(a)}<${idOf(a)}`, `${idOf(c)}<${idOf(a)}`].sort());

  const { records: merged, changed } = mergeRecords(records, fresh);
  assert.equal(changed, true);
  assert.deepEqual(vouches(merged, resolveMembers(merged, a), a, own, 6), []);
  assert.equal(mergeRecords(merged, [signMember(a, as(b, 'B'), 0)]).changed, false);
  assert.deepEqual(parseRecords(JSON.parse(JSON.stringify(merged))), merged);
  assert.deepEqual(parseRecords([{ type: 'member', deviceId: '../x' }, 'junk']), []);
});
