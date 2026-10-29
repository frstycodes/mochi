import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import sodium from 'libsodium-wrappers';
import { parseRecords, signMember } from './members.ts';
import {
  openMachineInfo,
  openRecords,
  sealMachineInfo,
  sealRecords,
  type MachineInfo,
} from './sealed.ts';
import type { DeviceKeys } from './session.ts';

await sodium.ready;

const keypair = (): DeviceKeys => sodium.crypto_sign_keypair();
const b64 = (bytes: Uint8Array) =>
  sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

const INFO: MachineInfo = {
  name: 'Studio',
  kind: 'mac',
  addresses: [{ host: '192.168.1.20', port: 47100, via: 'lan' }],
  updatedAt: 5,
};

test('a machine’s info opens for each member it was sealed to, and for nobody else', () => {
  const mac = keypair();
  const laptop = keypair();
  const stranger = keypair();
  const sealed = sealMachineInfo(INFO, [mac.publicKey, laptop.publicKey]);
  assert.deepEqual(openMachineInfo({ sealed }, mac), INFO);
  assert.deepEqual(openMachineInfo({ sealed }, laptop), INFO);
  assert.equal(openMachineInfo({ sealed }, stranger), undefined);
  assert.equal(openMachineInfo({}, mac), undefined);
  // What the relay stores and returns: no name, kind or address in it.
  assert.doesNotMatch(JSON.stringify(sealed), /Studio|"mac"|192\.168|47100/);
});

test('an entry swapped onto another member’s id doesn’t open', () => {
  const mac = keypair();
  const laptop = keypair();
  const sealed = sealMachineInfo(INFO, [mac.publicKey, laptop.publicKey]);
  const [macId, laptopId] = Object.keys(sealed);
  const swapped = { [macId]: sealed[laptopId], [laptopId]: sealed[macId] };
  assert.equal(openMachineInfo({ sealed: swapped }, mac), undefined);
});

test('member records reach the relay with name and kind sealed, and come back whole and still signed', () => {
  const mac = keypair();
  const pc = keypair();
  const record = signMember(
    mac,
    { publicKey: b64(pc.publicKey), name: 'Gaming PC', kind: 'windows' },
    10,
  );
  const atRelay = sealRecords([record], [mac.publicKey, pc.publicKey]);
  assert.doesNotMatch(
    JSON.stringify(atRelay),
    /Gaming PC|windows|"name"|"kind"/,
  );
  // Each member gets the record back as signed; the signature still checks in `members.ts`.
  assert.deepEqual(parseRecords(openRecords(atRelay, pc)), [record]);
  assert.deepEqual(
    openRecords(atRelay, keypair()),
    [],
    'a stranger gets nothing',
  );
});
