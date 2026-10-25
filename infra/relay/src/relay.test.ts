import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { CLOSE, splitChannel, withChannel, type StoredRecord } from './protocol.ts';
import { Relay, type Attachment, type MachineRecord, type Room } from './relay.ts';

interface FakeSocket {
  name: string;
  tags: string[];
  attachment: Attachment;
  sent: (string | Uint8Array)[];
  closed?: { code: number; reason: string };
}

/** The Durable Object as the relay sees it: tagged sockets and one storage key. Closing a socket drops it at once. */
function room() {
  const sockets: FakeSocket[] = [];
  let machines: Record<string, MachineRecord> = {};
  let records: Record<string, StoredRecord> = {};
  const fake: Room<FakeSocket> = {
    byTag: (tag) => sockets.filter((s) => !s.closed && s.tags.includes(tag)),
    attachment: (s) => s.attachment,
    send: (s, data) => void s.sent.push(data),
    close: (s, code, reason) => void (s.closed = { code, reason }),
    machines: async () => machines,
    saveMachines: async (next) => void (machines = next),
    records: async () => records,
    saveRecords: async (next) => void (records = next),
  };
  const relay = new Relay(fake, () => 1000, (() => { let n = 7; return () => n++; })());
  const accept = (name: string, admission: ReturnType<typeof relay.admit>) => {
    assert.ok(!('refusal' in admission), `${name} admitted`);
    const socket: FakeSocket = { name, tags: admission.tags, attachment: admission.attachment, sent: [] };
    sockets.push(socket);
    relay.opened(socket);
    return socket;
  };
  return { relay, accept, stored: () => machines };
}

const bytes = (...values: number[]) => new Uint8Array(values);
const asBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));

test('a device reaches only an online machine, and frames cross untouched with the channel added and removed', async () => {
  const { relay, accept } = room();
  assert.deepEqual(relay.admit('device', 'mac', 'phone'), { refusal: 'That machine is offline', code: CLOSE.machineOffline });

  const mac = accept('mac', relay.admit('machine', 'mac'));
  const phone = accept('phone', relay.admit('device', 'mac', 'phone'));
  assert.deepEqual(JSON.parse(mac.sent[0] as string), { type: 'open', channel: 7, deviceId: 'phone' });

  await relay.message(phone, asBuffer(bytes(1, 2, 3)));
  assert.deepEqual(splitChannel(mac.sent[1] as Uint8Array), { channel: 7, bytes: bytes(1, 2, 3) });

  await relay.message(mac, asBuffer(withChannel(7, bytes(9, 9))));
  assert.deepEqual(phone.sent, [bytes(9, 9)]);
});

test('frames never leak to another machine’s device, and an unknown channel is closed back at the machine', async () => {
  const { relay, accept } = room();
  const mac = accept('mac', relay.admit('machine', 'mac'));
  const pc = accept('pc', relay.admit('machine', 'pc'));
  const phone = accept('phone', relay.admit('device', 'mac', 'phone'));

  await relay.message(pc, asBuffer(withChannel(7, bytes(6))));
  assert.deepEqual(phone.sent, [], 'pc cannot write into mac’s channel');
  assert.deepEqual(JSON.parse(pc.sent.at(-1) as string), { type: 'close', channel: 7 });
  assert.equal(mac.sent.length, 1, 'only the open frame');
});

test('closing either end tells the other; a machine going offline closes its devices', async () => {
  const { relay, accept } = room();
  const mac = accept('mac', relay.admit('machine', 'mac'));
  const phone = accept('phone', relay.admit('device', 'mac', 'phone'));
  const tablet = accept('tablet', relay.admit('device', 'mac', 'tablet'));

  relay.closed(phone);
  assert.deepEqual(JSON.parse(mac.sent.at(-1) as string), { type: 'close', channel: 7 });

  await relay.message(mac, JSON.stringify({ type: 'close', channel: 8 }));
  assert.deepEqual(tablet.closed, { code: 1000, reason: 'Closed by the machine' });

  const laptop = accept('laptop', relay.admit('device', 'mac', 'laptop'));
  mac.closed = { code: 1006, reason: 'gone' };
  relay.closed(mac);
  assert.equal(laptop.closed?.code, CLOSE.machineOffline);
});

test('a machine reconnecting replaces its old socket without dropping the new one’s devices', () => {
  const { relay, accept } = room();
  const old = accept('old', relay.admit('machine', 'mac'));
  const fresh = accept('fresh', relay.admit('machine', 'mac'));
  assert.equal(old.closed?.code, CLOSE.replaced);
  const phone = accept('phone', relay.admit('device', 'mac', 'phone'));
  relay.closed(old);
  assert.equal(phone.closed, undefined);
  assert.ok(fresh.sent.length, 'the device opened on the new socket');
});

test('machines register with a name and key, list with online state, and removal closes them', async () => {
  const { relay, accept, stored } = room();
  const mac = accept('mac', relay.admit('machine', 'mac'));
  await relay.message(mac, JSON.stringify({ type: 'register', name: '  Studio  ', publicKey: KEY }));
  assert.deepEqual(stored(), { mac: { id: 'mac', name: 'Studio', publicKey: KEY, lastSeen: 1000 } });
  assert.deepEqual(await relay.list(), [{ id: 'mac', name: 'Studio', publicKey: KEY, lastSeen: 1000, isOnline: true }]);

  await relay.message(mac, JSON.stringify({ type: 'register', name: 'x', publicKey: 'short' }));
  assert.equal(mac.closed?.code, CLOSE.badFrame, 'a key that isn’t 32 bytes is refused');

  const pc = accept('pc', relay.admit('machine', 'pc'));
  await relay.message(pc, JSON.stringify({ type: 'register', name: 'PC', publicKey: KEY }));
  await relay.remove('pc');
  assert.equal(pc.closed?.code, CLOSE.machineOffline);
  assert.deepEqual(Object.keys(stored()), ['mac']);
});

test('devices may only send binary, and oversized frames are refused', async () => {
  const { relay, accept } = room();
  accept('mac', relay.admit('machine', 'mac'));
  const phone = accept('phone', relay.admit('device', 'mac', 'phone'));
  await relay.message(phone, '{"type":"register"}');
  assert.equal(phone.closed?.code, CLOSE.unsupported);
  const tablet = accept('tablet', relay.admit('device', 'mac', 'tablet'));
  await relay.message(tablet, new ArrayBuffer(1024 * 1024 + 5));
  assert.equal(tablet.closed?.code, CLOSE.tooBig);
});

test('membership records are kept newest per signer and subject, and online machines hear of a change', async () => {
  const { relay, accept } = room();
  const mac = accept('mac', relay.admit('machine', 'mac'));
  const member = (addedAt: number) => ({ type: 'member', deviceId: 'pc', publicKey: KEY, name: 'PC', addedBy: 'mac', addedAt, signature: 'sig' });
  await relay.addMembers([member(2), { type: 'member', deviceId: '../bad' }, 'junk']);
  assert.deepEqual(await relay.members(), [member(2)]);
  assert.deepEqual(JSON.parse(mac.sent.at(-1) as string), { type: 'members' });

  const heard = mac.sent.length;
  await relay.addMembers([member(1)]);
  assert.deepEqual(await relay.members(), [member(2)], 'an older record doesn’t replace a newer one');
  assert.equal(mac.sent.length, heard, 'nothing changed, nobody is told');

  await relay.addMembers([{ type: 'removal', deviceId: 'pc', removedBy: 'mac', removedAt: 3, signature: 'sig' }]);
  assert.equal((await relay.members()).length, 2);
});
