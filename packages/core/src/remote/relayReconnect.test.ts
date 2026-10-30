import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from '@effect/vitest';
import { WebSocketServer, type WebSocket } from 'ws';

/** Resolves on the next call of `signal`. */
function signals() {
  const waiting: (() => void)[] = [];
  return {
    next: () => new Promise<void>((resolve) => waiting.push(resolve)),
    signal: () => waiting.splice(0).forEach((resolve) => resolve()),
  };
}

// A fake relay: it signals each machine registration and can drop every socket, as a lost network does.
const http = createServer();
const wss = new WebSocketServer({ server: http });
const registered = signals();
const sockets = new Set<WebSocket>();
wss.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('message', (data: Buffer, isBinary) => {
    if (!isBinary && data.toString('utf8').startsWith('{"type":"register"'))
      registered.signal();
  });
});
let relay: typeof import('./relayClient.ts');

beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  process.env.MOCHI_RELAY_URL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  relay = await import('./relayClient.ts');
});
afterAll(() => {
  delete process.env.MOCHI_RELAY_URL;
  wss.close();
  http.close();
});

it('the machine registers again after the network drops and the token refresh fails while it is down', async () => {
  let isOffline = false;
  const triedOffline = signals();
  const states: string[] = [];
  const first = registered.next();
  const connection = relay.connectMachine({
    machineId: 'mac-1',
    name: () => 'Studio',
    publicKey: 'key',
    // Offline, the account's refresh rejects as fetch does with no network.
    token: async () => {
      if (!isOffline) return 'token';
      triedOffline.signal();
      throw new TypeError('fetch failed');
    },
    onChannel: () => {},
    onState: (state) => void states.push(state.status),
    onMembers: () => {},
  });
  await first;
  isOffline = true;
  const offline = triedOffline.next();
  for (const socket of sockets) socket.terminate();
  await offline;
  const again = registered.next();
  isOffline = false;
  await again;
  // It never gave up: no `error` between the drop and coming back.
  expect(states).not.toContain('error');
  connection.close();
}, 20_000);
