import assert from 'node:assert/strict';
import test from 'node:test';
import sodium from 'libsodium-wrappers';
import { DEFAULT_SCOPES } from '../../src/host/types/remote.ts';
import type { DeviceKeys } from './crypto/keys.ts';
import { queuedReader, type RawLink } from './link.ts';
import { deviceId, pairingCode, secureAsDevice, secureAsMachine, type MachineSide, type Origin, type PairedDevice } from './pairing.ts';

await sodium.ready;

const keypair = (): DeviceKeys => sodium.crypto_sign_keypair();

/** Two ends of one connection, like a relay channel: what one sends the other reads, in order. `tap` sees each frame first. */
function pipe(tap?: (bytes: Uint8Array, toMachine: boolean) => Uint8Array) {
  const ends = [makeEnd(), makeEnd()];
  function makeEnd() {
    const reader = queuedReader();
    const closes: ((code: number, reason: string) => void)[] = [];
    let isOpen = true;
    const end = { reader, closes, isOpen: () => isOpen, shut: (code: number, reason: string) => isOpen && ((isOpen = false), closes.forEach((c) => c(code, reason))) };
    return end;
  }
  const link = (self: number): RawLink => ({
    send: (bytes) => ends[self].isOpen() && queueMicrotask(() => ends[1 - self].reader.deliver(tap ? tap(bytes, self === 0) : bytes)),
    close: (code, reason) => ends.forEach((e) => e.shut(code, reason)),
    onMessage: ends[self].reader.set,
    onClose: (listener) => void ends[self].closes.push(listener),
    isOpen: () => ends[self].isOpen(),
  });
  return { device: link(0), machine: link(1) };
}

function machineSide(keys: DeviceKeys, answer: boolean, known: PairedDevice[] = []) {
  const asked: { name: string; code: string }[] = [];
  const added: PairedDevice[] = [];
  const side: MachineSide = {
    keys,
    find: (id) => [...known, ...added].find((d) => d.id === id),
    approve: async (request) => (asked.push(request), answer),
    add: (d) => {
      const paired = { ...d, scopes: DEFAULT_SCOPES, pairedAt: 1 };
      added.push(paired);
      return paired;
    },
  };
  return { side, asked, added };
}

async function pairOver(origin: Origin, machine: ReturnType<typeof machineSide>, machineKeys: DeviceKeys, device: DeviceKeys, expectedMachineKey = machineKeys.publicKey) {
  const ends = pipe();
  const [machineResult, deviceResult] = await Promise.allSettled([secureAsMachine(ends.machine, origin, machine.side), secureAsDevice(ends.device, device, expectedMachineKey, 'Laptop')]);
  return { machineResult, deviceResult };
}

test('a new device through the relay is asked about on the machine with the code both screens show, then talks encrypted', async () => {
  const machineKeys = keypair();
  const device = keypair();
  const machine = machineSide(machineKeys, true);
  const { machineResult, deviceResult } = await pairOver('relay', machine, machineKeys, device);
  assert.equal(machineResult.status, 'fulfilled');
  assert.equal(deviceResult.status, 'fulfilled');
  assert.deepEqual(machine.asked, [{ name: 'Laptop', code: pairingCode(machineKeys.publicKey, device.publicKey) }]);
  assert.match(machine.asked[0].code, /^\d{3} \d{3}$/);
  assert.equal(machine.added[0].id, deviceId(device.publicKey));

  const secured = machineResult.status === 'fulfilled' && machineResult.value;
  assert.ok(secured && 'link' in secured);
  assert.deepEqual(secured.device, { deviceId: deviceId(device.publicKey), name: 'Laptop', scopes: DEFAULT_SCOPES });
  const deviceLink = deviceResult.status === 'fulfilled' ? deviceResult.value : assert.fail();
  const heard = new Promise<string>((resolve) => secured.link.onMessage(resolve));
  deviceLink.send('{"type":"hello"}');
  assert.equal(await heard, '{"type":"hello"}');
});

test('No on the machine refuses the device and trusts nothing', async () => {
  const machineKeys = keypair();
  const machine = machineSide(machineKeys, false);
  const { machineResult, deviceResult } = await pairOver('relay', machine, machineKeys, keypair());
  assert.deepEqual(machineResult.status === 'fulfilled' && machineResult.value, { refusal: 'Not allowed on this computer' });
  assert.equal(deviceResult.status === 'rejected' && (deviceResult.reason as Error).message, 'Not allowed on this computer');
  assert.deepEqual(machine.added, []);
});

test('an unknown device on the LAN is refused without asking; a paired one connects with no prompt', async () => {
  const machineKeys = keypair();
  const device = keypair();
  const stranger = machineSide(machineKeys, true);
  const refused = await pairOver('lan', stranger, machineKeys, device);
  assert.equal(refused.deviceResult.status === 'rejected' && (refused.deviceResult.reason as Error).message, 'Pair this device through your Mochi account first');
  assert.deepEqual(stranger.asked, []);

  const known = machineSide(machineKeys, false, [{ id: deviceId(device.publicKey), name: 'Laptop', publicKey: '', scopes: ['read'], pairedAt: 1 }]);
  const paired = await pairOver('lan', known, machineKeys, device);
  assert.equal(paired.deviceResult.status, 'fulfilled');
  assert.deepEqual(known.asked, []);
  const secured = paired.machineResult.status === 'fulfilled' && paired.machineResult.value;
  assert.deepEqual(secured && 'device' in secured && secured.device.scopes, ['read'], 'the scopes this machine gave it');
});

test('a relay that swaps the machine’s key fails the handshake, and the codes on the two screens differ', async () => {
  const machineKeys = keypair();
  const impostor = keypair();
  const device = keypair();
  const machine = machineSide(machineKeys, true);
  const { deviceResult } = await pairOver('relay', machine, machineKeys, device, impostor.publicKey);
  assert.equal(deviceResult.status === 'rejected' && (deviceResult.reason as Error).message, 'That computer’s key doesn’t match; pair again from its current listing');
  assert.notEqual(pairingCode(impostor.publicKey, device.publicKey), machine.asked[0].code);
});

test('a pairing request naming one key but signed with another is refused before anyone is asked', async () => {
  const machineKeys = keypair();
  const victim = keypair();
  const attacker = keypair();
  const machine = machineSide(machineKeys, true);
  // The attacker's handshake, with the victim's public key swapped into the request.
  const ends = pipe((bytes, toMachine) => {
    if (!toMachine) return bytes;
    const frame = JSON.parse(sodium.to_string(bytes)) as Record<string, unknown>;
    return sodium.from_string(JSON.stringify({ ...frame, publicKey: sodium.to_base64(victim.publicKey, sodium.base64_variants.ORIGINAL) }));
  });
  const [machineResult] = await Promise.allSettled([secureAsMachine(ends.machine, 'relay', machine.side), secureAsDevice(ends.device, attacker, machineKeys.publicKey, 'Laptop')]);
  assert.deepEqual(machineResult.status === 'fulfilled' && machineResult.value, { refusal: 'The pairing request wasn’t signed by the key it names' });
  assert.deepEqual(machine.asked, []);
});

test('a tampered frame after pairing ends the connection', async () => {
  const machineKeys = keypair();
  const device = keypair();
  let isPaired = false;
  const ends = pipe((bytes, toMachine) => (toMachine && isPaired ? bytes.map((b, i) => (i === bytes.length - 1 ? b ^ 1 : b)) : bytes));
  const machine = machineSide(machineKeys, true);
  const [machineResult, deviceResult] = await Promise.all([secureAsMachine(ends.machine, 'relay', machine.side), secureAsDevice(ends.device, device, machineKeys.publicKey, 'Laptop')]);
  isPaired = true;
  assert.ok('link' in machineResult);
  const closed = new Promise<void>((resolve) => machineResult.link.onClose(resolve));
  machineResult.link.onMessage(() => assert.fail('a tampered frame must not be read'));
  deviceResult.send('hello');
  await closed;
});
