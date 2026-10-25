import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from '@effect/vitest';
import { Schema } from 'effect';

// The relay's HTTP API, faked: each path answers with its body.
const answers: Record<string, { status: number; body: unknown }> = {
  '/v1/machines': { status: 200, body: [{ id: 'mac-1', name: 'Mac' }] },
  '/v1/members': { status: 401, body: {} },
};
const server = createServer((request, response) => {
  const answer = answers[request.url ?? ''] ?? { status: 404, body: {} };
  response.writeHead(answer.status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(answer.body));
});
let relay: typeof import('./relayClient.ts');

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Read once, when the module loads.
  process.env.MOCHI_RELAY_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  relay = await import('./relayClient.ts');
});
afterAll(() => {
  delete process.env.MOCHI_RELAY_URL;
  server.close();
});

it('a machine listing of the wrong shape rejects with a SchemaError', async () => {
  await expect(relay.listMachines('token')).rejects.toBeInstanceOf(
    Schema.SchemaError,
  );
});

it('a refused request rejects with the status the relay answered', async () => {
  await expect(relay.listMembers('token')).rejects.toMatchObject({
    _tag: 'RelayRefused',
    message: 'The relay answered 401',
  });
});
