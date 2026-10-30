import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from '@effect/vitest';
import sodium from 'libsodium-wrappers';
import { WebSocketServer, type RawData } from 'ws';
import { DEFAULT_SCOPES } from '../../../../apps/desktop/src/host/types/remote.ts';
import { queuedReader, type RawLink } from './link.ts';
import { secureAsMachine, type MachineSide } from './pairing.ts';
import { sealMachineInfo } from './sealed.ts';

/**
 * The rule (DEVICES.md › End-to-end encryption): every byte remote access sends off the machine is end-to-end encrypted
 * or TLS to itself. These fail if a route starts carrying plaintext: what the machine tells the relay names nothing, and
 * a connection that skips the pairing handshake gets no further.
 */

await sodium.ready;

const NAME = 'Studio of Someone';
const frames: { text?: string; bytes?: Uint8Array }[] = [];
const http = createServer();
const wss = new WebSocketServer({ server: http });
wss.on('connection', (socket) =>
  socket.on('message', (data: RawData, isBinary) =>
    frames.push(
      isBinary
        ? { bytes: new Uint8Array(data as Buffer) }
        : { text: (data as Buffer).toString() },
    ),
  ),
);
let relay: typeof import('./relayClient.ts');

beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  // Read once, when the module loads.
  process.env.MOCHI_RELAY_URL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  relay = await import('./relayClient.ts');
});
afterAll(() => {
  delete process.env.MOCHI_RELAY_URL;
  wss.close();
  http.close();
});

it('the machine’s registration at the relay carries its key and sealed info, never its name, kind or addresses', async () => {
  const keys = sodium.crypto_sign_keypair();
  const publicKey = sodium.to_base64(
    keys.publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const sealed = () =>
    sealMachineInfo(
      {
        name: NAME,
        kind: 'linux',
        addresses: [{ host: '10.1.2.3', port: 47100, via: 'lan' }],
        updatedAt: 1,
      },
      [keys.publicKey],
    );
  const connection = relay.connectMachine({
    machineId: 'machine-1',
    sealed,
    publicKey,
    token: async () => 'token',
    onChannel: () => {},
    onState: () => {},
    onMembers: () => {},
  });
  await expect.poll(() => frames.length).toBeGreaterThan(0);
  connection.reregister();
  await expect.poll(() => frames.length).toBeGreaterThan(1);
  connection.close();

  for (const frame of frames) {
    const register = JSON.parse(frame.text!) as Record<string, unknown>;
    expect(Object.keys(register).sort()).toEqual([
      'publicKey',
      'sealed',
      'type',
    ]);
    expect(frame.text).not.toMatch(/Studio|linux|10\.1\.2\.3|47100/);
  }
});

/** One end of a channel, as the relay or the LAN server hands it to `secureAsMachine`. */
function channel() {
  const reader = queuedReader();
  const sent: Uint8Array[] = [];
  let closed: number | undefined;
  const link: RawLink = {
    send: (bytes) => void sent.push(bytes),
    close: (code) => void (closed = code),
    onMessage: reader.set,
    onClose: () => {},
    isOpen: () => closed === undefined,
  };
  return { link, deliver: reader.deliver, sent };
}

it('a connection that opens with a plain command instead of the pairing handshake is refused, and nobody is asked', async () => {
  const keys = sodium.crypto_sign_keypair();
  const asked: string[] = [];
  const side: MachineSide = {
    keys,
    find: () => ({
      id: 'x',
      name: 'x',
      publicKey: '',
      scopes: DEFAULT_SCOPES,
      pairedAt: 0,
    }),
    refresh: async () => {},
    approve: async (request) => (asked.push(request.name), true),
    add: async () => undefined,
  };
  for (const origin of ['lan', 'relay'] as const) {
    const { link, deliver } = channel();
    const secured = secureAsMachine(link, origin, side);
    deliver(
      sodium.from_string(
        JSON.stringify({ type: 'command', command: { type: 'send' } }),
      ),
    );
    expect(await secured).toEqual({
      refusal: 'The first frame must be a pairing request',
    });
  }
  expect(asked).toEqual([]);
});
