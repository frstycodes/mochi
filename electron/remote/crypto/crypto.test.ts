import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vite-plus/test';
import sodium from 'libsodium-wrappers';
import { loadDeviceKeys, type DeviceKeys } from './keys.ts';
import { createHandshake, E2EError, type E2EErrorCode, type Session } from '@mochi/core/remote/session';

await sodium.ready;

function keypair(): DeviceKeys {
  const { publicKey, privateKey } = sodium.crypto_sign_keypair();
  return { publicKey, privateKey };
}

async function pair(machine = keypair(), device = keypair()): Promise<{ machine: Session; device: Session }> {
  const m = await createHandshake(machine, device.publicKey, 'machine');
  const d = await createHandshake(device, machine.publicKey, 'device');
  return { machine: m.finish(d.hello), device: d.finish(m.hello) };
}

const bytes = (text: string) => sodium.from_string(text);
const rejects = (code: E2EErrorCode) => (error: unknown) => error instanceof E2EError && error.code === code;

test('frames round-trip both ways, in order', async () => {
  const { machine, device } = await pair();
  for (const text of ['one', 'two', ''])
    assert.equal(sodium.to_string(device.decrypt(machine.encrypt(bytes(text)))), text);
  assert.equal(sodium.to_string(machine.decrypt(device.encrypt(bytes('back')))), 'back');
});

test('a tampered frame is rejected and the genuine one still decrypts', async () => {
  const { machine, device } = await pair();
  const first = machine.encrypt(bytes('first'));
  device.decrypt(first);
  const frame = machine.encrypt(bytes('run rm -rf'));
  const flip = (index: number) => frame.map((byte, i) => (i === index ? byte ^ 1 : byte));
  assert.throws(() => device.decrypt(flip(frame.length - 1)), rejects('tampered'));
  assert.throws(() => device.decrypt(flip(8)), rejects('tampered'));
  assert.throws(() => device.decrypt(flip(7)), rejects('replayed'));
  assert.throws(() => device.decrypt(flip(6)), rejects('out-of-order'));
  assert.throws(() => device.decrypt(frame.subarray(0, 4)), rejects('tampered'));
  assert.equal(sodium.to_string(device.decrypt(frame)), 'run rm -rf');
});

test('a forged first frame (header) is rejected', async () => {
  const { machine, device } = await pair();
  const frame = machine.encrypt(bytes('hi'));
  const forged = frame.slice();
  forged[10] ^= 1;
  assert.throws(() => device.decrypt(forged), rejects('tampered'));
  assert.equal(sodium.to_string(device.decrypt(frame)), 'hi');
});

test('replayed and out-of-order frames are rejected', async () => {
  const { machine, device } = await pair();
  const [a, b, c] = ['a', 'b', 'c'].map((t) => machine.encrypt(bytes(t)));
  device.decrypt(a);
  assert.throws(() => device.decrypt(a), rejects('replayed'));
  assert.throws(() => device.decrypt(c), rejects('out-of-order'));
  assert.equal(sodium.to_string(device.decrypt(b)), 'b');
  assert.equal(sodium.to_string(device.decrypt(c)), 'c');
  assert.throws(() => device.decrypt(b), rejects('replayed'));
});

test('a hello from a key other than the paired one is rejected', async () => {
  const machine = keypair();
  const paired = keypair();
  const stranger = keypair();
  const m = await createHandshake(machine, paired.publicKey, 'machine');
  const unpaired = await createHandshake(stranger, machine.publicKey, 'device');
  assert.throws(() => m.finish(unpaired.hello), rejects('wrong-key'));
  const impostor = await createHandshake({ publicKey: paired.publicKey, privateKey: stranger.privateKey }, machine.publicKey, 'device');
  assert.throws(() => m.finish(impostor.hello), rejects('wrong-key'));
  assert.throws(() => m.finish(m.hello), rejects('wrong-key'));
  assert.throws(() => m.finish(new Uint8Array(3)), rejects('wrong-key'));
});

test('frames from another session are rejected', async () => {
  const machine = keypair();
  const device = keypair();
  const ours = await pair(machine, device);
  const theirs = await pair(keypair(), device);
  assert.throws(() => ours.device.decrypt(theirs.machine.encrypt(bytes('x'))), rejects('tampered'));
});

function fakeStorage(backend: 'basic_text' | 'gnome_libsecret' | 'unknown', available = true) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (cipher: Buffer) => cipher.toString().replace(/^enc:/, ''),
  };
}

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-e2e-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the device key is stored encrypted and reloads to the same key', async () => {
  const dir = scratchDir();
  const first = await loadDeviceKeys(fakeStorage('gnome_libsecret'), dir, 'linux');
  assert.equal(first.persisted, true);
  assert.deepEqual(readdirSync(dir), ['device-key']);
  const again = await loadDeviceKeys(fakeStorage('gnome_libsecret'), dir, 'linux');
  assert.deepEqual(again.keys, first.keys);
});

test('a weak Linux backend keeps the key in memory only', async () => {
  for (const storage of [fakeStorage('basic_text'), fakeStorage('unknown'), fakeStorage('gnome_libsecret', false)]) {
    const dir = scratchDir();
    const first = await loadDeviceKeys(storage, dir, 'linux');
    assert.equal(first.persisted, false);
    assert.equal(existsSync(join(dir, 'device-key')), false);
    assert.deepEqual((await loadDeviceKeys(storage, dir, 'linux')).keys, first.keys);
  }
});

test('the Linux backend is not consulted on macOS and Windows', async () => {
  const storage = fakeStorage('basic_text');
  storage.getSelectedStorageBackend = () => assert.fail('linux-only API called');
  assert.equal((await loadDeviceKeys(storage, scratchDir(), 'darwin')).persisted, true);
});
