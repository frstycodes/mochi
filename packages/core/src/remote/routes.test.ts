import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import sodium from 'libsodium-wrappers';
import { asCandidate, routesTo } from './routes.ts';
import { sealMachineInfo } from './sealed.ts';

await sodium.ready;

it('a bound address is a candidate when private, tagged Tailscale or LAN; loopback and public never are', () => {
  assert.deepEqual(asCandidate('192.168.1.4:4521'), {
    host: '192.168.1.4',
    port: 4521,
    via: 'lan',
  });
  assert.equal(asCandidate('100.101.1.2:4521')?.via, 'tailscale');
  assert.equal(asCandidate('[fd7a:115c:a1e0::1]:4521')?.via, 'tailscale');
  assert.equal(asCandidate('[fd12::1]:4521')?.via, 'lan');
  assert.equal(asCandidate('127.0.0.1:4521'), undefined);
  assert.equal(asCandidate('8.8.8.8:4521'), undefined);
});

it.effect(
  'routes merge the sealed addresses with the last welcome, then the relay; the same site carries over',
  () =>
    Effect.gen(function* () {
      const keys = sodium.crypto_sign_keypair();
      const sealed = sealMachineInfo(
        {
          name: 'Studio',
          kind: 'mac',
          addresses: [{ host: '10.0.2.7', port: 4521, via: 'lan' }],
          updatedAt: 1,
        },
        [keys.publicKey],
      );
      const relay = { kind: 'relay' as const, open: () => Promise.reject() };
      const routes = yield* Effect.promise(() =>
        routesTo({
          machineId: 'mac-1',
          known: ['192.168.1.4:4521', '10.0.2.7:4521'],
          token: async () => 'token',
          keys: async () => keys,
          relay,
          list: async () => [
            {
              id: 'mac-1',
              publicKey: 'k',
              isOnline: true,
              sealed,
              sameSite: true,
            },
          ],
        }),
      );
      assert.equal(routes.direct.length, 2);
      assert.ok(routes.direct.every((r) => r.kind === 'lan'));
      assert.equal(routes.relay, relay);
      assert.equal(routes.isSameSite, true);
    }),
);

it.effect('a listing that fails still dials the known addresses', () =>
  Effect.gen(function* () {
    const routes = yield* Effect.promise(() =>
      routesTo({
        machineId: 'mac-1',
        known: ['192.168.1.4:4521'],
        token: async () => {
          throw new TypeError('fetch failed');
        },
        keys: async () => sodium.crypto_sign_keypair(),
      }),
    );
    assert.equal(routes.direct.length, 1);
    assert.equal(routes.relay, undefined);
    assert.equal(routes.isSameSite, false);
  }),
);
