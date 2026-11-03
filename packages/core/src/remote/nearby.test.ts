import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'vite-plus/test';
import sodium from 'libsodium-wrappers';
import { WebSocketServer } from 'ws';
import {
  broadcastAddresses,
  encodeAnnouncement,
  mergeNearby,
  parseAnnouncement,
  type NearbyComputer,
} from './nearby.ts';
import { knownAddresses, routesTo } from './routes.ts';

await sodium.ready;

const keyOf = () =>
  sodium.to_base64(
    sodium.crypto_sign_keypair().publicKey,
    sodium.base64_variants.ORIGINAL,
  );
const own = keyOf();
const theirs = keyOf();
const lan = { address: '192.168.1.20', family: 'IPv4' as const };

test('an announcement reads back as the computer that sent it, dialled where it was heard from', () => {
  const bytes = encodeAnnouncement({
    id: 'pc-1',
    publicKey: theirs,
    port: 47373,
  });
  assert.deepEqual(parseAnnouncement(bytes, lan, own, 5), {
    id: 'pc-1',
    publicKey: theirs,
    port: 47373,
    address: '192.168.1.20:47373',
    seenAt: 5,
  });
  assert.ok(!bytes.toString().includes('name'), 'no name on the wire');
});

test('malformed, oversized, loopback, public and this computer’s own announcements are ignored', () => {
  const valid = { id: 'pc-1', publicKey: theirs, port: 47373 };
  const parse = (bytes: Uint8Array, from = lan) =>
    parseAnnouncement(bytes, from, own);
  for (const bytes of [
    Buffer.from('not json'),
    Buffer.from(JSON.stringify(valid)),
    Buffer.from(JSON.stringify({ mochi: 2, ...valid })),
    encodeAnnouncement({ ...valid, publicKey: 'short' }),
    encodeAnnouncement({ ...valid, id: 'has spaces' }),
    encodeAnnouncement({ ...valid, port: 0 }),
    encodeAnnouncement({ ...valid, port: 1.5 }),
    Buffer.alloc(600, 0x20),
  ])
    assert.equal(parse(bytes), undefined, bytes.toString().slice(0, 60));
  const bytes = encodeAnnouncement(valid);
  assert.equal(
    parse(bytes, { address: '127.0.0.1', family: 'IPv4' as const }),
    undefined,
  );
  assert.equal(
    parse(bytes, { address: '8.8.8.8', family: 'IPv4' as const }),
    undefined,
  );
  assert.equal(
    parse(encodeAnnouncement({ ...valid, publicKey: own })),
    undefined,
    'its own broadcast, heard back',
  );
});

test('each private IPv4 network is broadcast to once; loopback, /32, public and IPv6 are not', () => {
  const entry = (
    address: string,
    netmask: string,
    family = 'IPv4',
    internal = false,
  ) => ({ address, netmask, family, internal, mac: '', cidr: null }) as never;
  assert.deepEqual(
    broadcastAddresses({
      lo0: [entry('127.0.0.1', '255.0.0.0', 'IPv4', true)],
      en0: [
        entry('192.168.1.20', '255.255.255.0'),
        entry('fd12::1', 'ffff::', 'IPv6'),
      ],
      en1: [entry('10.4.7.9', '255.255.0.0')],
      bridge: [entry('192.168.1.21', '255.255.255.0')],
      utun3: [entry('100.101.1.2', '255.255.255.255')],
      public: [entry('8.8.8.8', '255.255.255.0')],
    }),
    ['192.168.1.255', '10.4.255.255'],
  );
});

const heard = (
  c: Partial<NearbyComputer> & Pick<NearbyComputer, 'id' | 'publicKey'>,
): NearbyComputer => ({
  port: 47373,
  address: '192.168.1.20:47373',
  seenAt: 1,
  ...c,
});

test('the relay’s listing and the computers heard nearby merge into one entry per key', () => {
  const both = keyOf();
  const relayOnly = keyOf();
  const merged = mergeNearby(
    [
      { id: 'mac-1', publicKey: both, isOnline: false },
      { id: 'mac-2', publicKey: relayOnly, isOnline: true },
    ],
    [
      heard({ id: 'mac-1', publicKey: both }),
      heard({ id: 'pc-1', publicKey: theirs, address: '192.168.1.30:47373' }),
      heard({ id: 'pc-1', publicKey: keyOf() }),
      heard({ id: 'mac-2', publicKey: keyOf() }),
    ],
  );
  assert.deepEqual(
    merged.map(({ id, isOnline, isNearby, address }) => ({
      id,
      isOnline,
      isNearby,
      address,
    })),
    [
      {
        id: 'mac-1',
        isOnline: true,
        isNearby: true,
        address: '192.168.1.20:47373',
      },
      { id: 'mac-2', isOnline: true, isNearby: false, address: undefined },
      {
        id: 'pc-1',
        isOnline: true,
        isNearby: true,
        address: '192.168.1.30:47373',
      },
    ],
    'heard means online; a second key under a known id, listed or heard, is dropped',
  );
  assert.equal(merged[0]!.listed?.id, 'mac-1');
  assert.equal(merged[2]!.listed, undefined);
});

test('a member heard nearby is dialled there when the relay’s listing is unreachable', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const connected = new Promise((resolve) =>
    server.once('connection', resolve),
  );
  const at = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const known = knownAddresses(
      {
        machines: [{ id: 'pc-1', publicKey: theirs }],
        nearby: { [theirs]: at, [keyOf()]: '192.168.1.99:47373' },
      },
      'pc-1',
    );
    assert.deepEqual(known, [at]);
    const routes = await routesTo({
      machineId: 'pc-1',
      known,
      token: async () => {
        throw new TypeError('fetch failed');
      },
      keys: async () => sodium.crypto_sign_keypair(),
    });
    assert.equal(routes.direct.length, 1);
    const link = await routes.direct[0]!.open();
    await connected;
    link.close(1000, 'done');
  } finally {
    server.close();
  }
});
