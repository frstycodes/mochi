import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Context, Deferred, Effect, Layer, Queue, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import sodium from 'libsodium-wrappers';
import { SecretKey } from '@number0/iroh';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '../client.ts';
import { makeHostCaller } from '../hostClient.ts';
import { layerCore } from '../server.ts';
import { makeDeviceClient, openLan, type Route } from './device.ts';
import {
  bindIroh,
  loadIroh,
  type IrohBinding,
  type IrohNode,
  type IrohPreset,
} from './iroh.ts';
import { irohThroughCore } from './irohPipe.ts';
import type { RawLink } from './link.ts';
import {
  ACCOUNT_FIRST,
  deviceId,
  PairingRefused,
  secureAsDevice,
  secureAsMachine,
  type MachineSide,
  type PairedDevice,
} from './pairing.ts';
import { startRemoteServer, type RemoteServer } from './server.ts';
import { mintDeviceToken } from './token.ts';
import type { DeviceKeys } from './session.ts';

await sodium.ready;
const loaded = await loadIroh();
if ('reason' in loaded) throw new Error(loaded.reason);
const iroh: IrohBinding = loaded.iroh;

const TOKEN = 'core-token';

/** Offline on loopback: no relay, no discovery, so a dialler is given the listener's bound sockets. */
const loopback: IrohPreset = (builder, binding) => {
  binding.presetMinimal(builder);
  builder.relayMode(binding.RelayMode.disabled());
  builder.bindAddr('127.0.0.1:0');
};

/** A computer's keys from a seed, as `service.ts` derives them, and its endpoint keyed with the same seed. */
const computer = Effect.gen(function* () {
  const seed = sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES);
  const keys: DeviceKeys = sodium.crypto_sign_seed_keypair(seed);
  const node = yield* Effect.acquireRelease(
    Effect.promise(() => bindIroh(iroh, seed, { preset: loopback })),
    (node) => Effect.promise(() => node.close()),
  );
  return { keys, node };
});

const dialTo = (from: IrohNode, to: { keys: DeviceKeys; node: IrohNode }) =>
  from.dial(to.keys.publicKey, { addresses: to.node.sockets() });

const closedWith = (raw: RawLink) =>
  new Promise<[number, string]>((resolve) =>
    raw.onClose((code, reason) => resolve([code, reason])),
  );

const b64 = (bytes: Uint8Array) =>
  sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

const member = (keys: DeviceKeys): PairedDevice => ({
  id: deviceId(keys.publicKey),
  name: 'Laptop',
  publicKey: b64(keys.publicKey),
  scopes: ['read', 'operate', 'manage', 'code'],
  pairedAt: 1,
});

const machineSide = (
  keys: DeviceKeys,
  {
    known = [],
    onAccount = [],
  }: { known?: PairedDevice[]; onAccount?: Uint8Array[] } = {},
) => {
  const asked: string[] = [];
  const side: MachineSide = {
    keys,
    find: (id) => known.find((d) => d.id === id),
    refresh: async () => {},
    isOnAccount: async (publicKey) =>
      onAccount.some((key) => sodium.memcmp(key, publicKey)),
    approve: async (request) => (asked.push(request.code), true),
    add: async (device) => ({ ...device, scopes: ['read'], pairedAt: 1 }),
  };
  return { side, asked };
};

it.live(
  'frames survive QUIC chunking in order, and a close reaches the peer after what was sent, with its code and reason',
  () =>
    Effect.gen(function* () {
      const machine = yield* computer;
      const device = yield* computer;
      const received: Uint8Array[] = [];
      const machineClosed = yield* Deferred.make<[number, string]>();
      machine.node.accept((raw) => {
        void closedWith(raw).then((closed) =>
          Deferred.doneUnsafe(machineClosed, Effect.succeed(closed)),
        );
        raw.onMessage((bytes) => {
          received.push(bytes);
          if (received.length === 3) raw.close(4401, 'Refused');
        });
      });
      const raw = yield* Effect.promise(() => dialTo(device.node, machine));
      const big = sodium.randombytes_buf(900 * 1024);
      raw.send(new Uint8Array([1, 2, 3]));
      raw.send(big);
      raw.send(new Uint8Array(0));
      assert.deepEqual(yield* Effect.promise(() => closedWith(raw)), [
        4401,
        'Refused',
      ]);
      assert.deepEqual(yield* Deferred.await(machineClosed), [4401, 'Refused']);
      assert.equal(raw.isOpen(), false);
      assert.deepEqual(
        received.map((bytes) => bytes.length),
        [3, big.length, 0],
      );
      assert.deepEqual(received[1], big);
    }),
);

it('our Ed25519 device seed is an iroh SecretKey: the EndpointId is the device public key', () => {
  const seed = sodium.randombytes_buf(32);
  const ours = sodium.crypto_sign_seed_keypair(seed);
  const secret = SecretKey.fromBytes([...seed]);
  assert.deepEqual(Uint8Array.from(secret.public().toBytes()), ours.publicKey);
  const message = sodium.from_string('pair');
  assert.ok(
    sodium.crypto_sign_verify_detached(
      Uint8Array.from(secret.sign([...message]).toBytes()),
      message,
      ours.publicKey,
    ),
  );
});

it.live(
  'an endpoint bound with the device seed is that device: its id is the public key, and a peer sees that key',
  () =>
    Effect.gen(function* () {
      const machine = yield* computer;
      const device = yield* computer;
      assert.equal(
        machine.node.id,
        Buffer.from(machine.keys.publicKey).toString('hex'),
      );
      const accepted = yield* Deferred.make<Uint8Array>();
      machine.node.accept((link) =>
        Deferred.doneUnsafe(accepted, Effect.succeed(link.peer)),
      );
      const link = yield* Effect.promise(() => dialTo(device.node, machine));
      link.send(new Uint8Array([1]));
      assert.deepEqual(yield* Deferred.await(accepted), device.keys.publicKey);
      assert.deepEqual(link.peer, machine.keys.publicKey);
      assert.equal(link.path(), 'direct');
    }),
);

it.live(
  'an unknown key over iroh is refused without a prompt, unless the account lists it: then it is asked about',
  () =>
    Effect.gen(function* () {
      const machine = yield* computer;
      const device = yield* computer;
      const pairOver = (side: MachineSide) =>
        Effect.promise(async () => {
          machine.node.accept(
            (raw) =>
              void secureAsMachine(raw, 'iroh', side).then(
                (secured) => 'refusal' in secured && raw.close(4401, 'Refused'),
              ),
          );
          const raw = await dialTo(device.node, machine);
          return secureAsDevice(
            raw,
            device.keys,
            machine.keys.publicKey,
            'Laptop',
          ).then(
            (link) => (link.close(1000, 'Done'), 'paired'),
            (error: unknown) => error,
          );
        });

      const stranger = machineSide(machine.keys);
      const refused = yield* pairOver(stranger.side);
      assert.ok(refused instanceof PairingRefused, String(refused));
      assert.equal(refused.message, ACCOUNT_FIRST);
      assert.deepEqual(stranger.asked, []);

      const yours = machineSide(machine.keys, {
        onAccount: [device.keys.publicKey],
      });
      assert.equal(yield* pairOver(yours.side), 'paired');
      assert.equal(yours.asked.length, 1);
    }),
);

/**
 * Core in-process, and a machine reachable over iroh and on 127.0.0.1, with the device as its member. `remote` builds a
 * device client over whichever routes a test gives it, reporting the route each welcome came on.
 */
const machineWithDevice = Effect.gen(function* () {
  const context = yield* Layer.build(
    layerCore({
      port: 0,
      tokens: new Map([[TOKEN, Capabilities.allScopes]]),
      origins: [],
    }),
  );
  const port = (
    Context.get(context, HttpServer.HttpServer).address as { port: number }
  ).port;
  const window = yield* makeCoreClient(coreUrl(port, TOKEN, 7));
  const machine = yield* computer;
  const device = yield* computer;
  const { side } = machineSide(machine.keys, { known: [member(device.keys)] });
  const server = yield* serve(side, port);
  machine.node.accept((link) => server.attach(link, 'iroh'));
  const welcomed = yield* Queue.unbounded<Route['kind']>();
  const client = (routes: () => { iroh?: Route; direct: Route[] }) =>
    makeDeviceClient({
      routes,
      secure: (raw) =>
        secureAsDevice(
          raw,
          device.keys,
          machine.keys.publicKey,
          'Laptop',
          true,
        ),
      isRefusal: (error) => error instanceof PairingRefused,
      onWelcome: (_welcome, route) => Queue.offerUnsafe(welcomed, route),
      onOffline: () => {},
      onRefused: (reason) => assert.fail(reason),
    });
  const lan: Route = { kind: 'lan', open: () => openLan(server.addresses[0]!) };
  const viaIroh: Route = {
    kind: 'iroh',
    open: () => dialTo(device.node, machine),
  };
  return { window, server, client, welcomed, lan, viaIroh };
});

const serve = (side: MachineSide, port: number) =>
  Effect.acquireRelease(
    Effect.promise(() =>
      startRemoteServer({
        hosts: ['127.0.0.1'],
        port: 0,
        secure: (raw, origin) => secureAsMachine(raw, origin, side),
        coreFor: async (grant) => ({
          url: coreUrl(port, '').split('#')[0]!,
          token: mintDeviceToken(TOKEN, grant),
        }),
        backend: async (scopes) => ({
          id: 'studio',
          name: 'Studio',
          kind: 'mac',
          appVersion: '0.0.0',
          protocolVersion: Capabilities.PROTOCOL_VERSION,
          capabilities: [],
          scopes,
        }),
        irohRelay: () => 'https://relay.example/',
        onRejected: (_device, reason) => assert.fail(reason),
      }),
    ),
    (server: RemoteServer) => Effect.promise(() => server.close()),
  );

it.live(
  'a paired device reads the same `thread` stream a window does, over iroh, which wins over the LAN when both answer',
  () =>
    Effect.gen(function* () {
      const { window, server, client, welcomed, lan, viaIroh } =
        yield* machineWithDevice;
      const device = yield* client(() => ({ iroh: viaIroh, direct: [lan] }));
      assert.equal(yield* Queue.take(welcomed), 'iroh');
      assert.deepEqual(
        server.routes().map(({ origin, path }) => [origin, path]),
        [['iroh', 'direct']],
      );

      yield* window['events.append']({
        type: 'command',
        threadId: null,
        payload: {
          type: 'create',
          spaceId: 's',
          title: 'Fix login',
          name: 'Fix login',
          provider: 'claude',
          project: null,
          isLive: true,
        },
      });
      const firstSnapshot = (from: typeof window) =>
        from.thread({ threadId: 'new-1', afterSequence: 0 }).pipe(
          // A snapshot taken before Core saved the new thread holds `null`.
          Stream.filter((item) => item._tag === 'snapshot' && !!item.saved),
          Stream.take(1),
          Stream.runCollect,
        );
      const [fromWindow, fromDevice] = yield* Effect.all(
        [firstSnapshot(window), firstSnapshot(device)],
        { concurrency: 'unbounded' },
      );
      assert.deepEqual([...fromDevice], [...fromWindow]);
    }),
  30_000,
);

it.live(
  'with iroh unavailable, the LAN carries the session at once',
  () =>
    Effect.gen(function* () {
      const { client, welcomed, lan } = yield* machineWithDevice;
      const device = yield* client(() => ({
        iroh: {
          kind: 'iroh',
          open: () => Promise.reject(new Error('iroh isn’t available here')),
        },
        direct: [lan],
      }));
      assert.equal(yield* Queue.take(welcomed), 'lan');
      yield* device.ping();
    }),
  30_000,
);

it.live(
  'when iroh doesn’t connect within its head start, the LAN carries the session',
  () =>
    Effect.gen(function* () {
      const { client, welcomed, lan } = yield* machineWithDevice;
      const device = yield* client(() => ({
        iroh: { kind: 'iroh', open: () => new Promise<never>(() => {}) },
        direct: [lan],
      }));
      assert.equal(yield* Queue.take(welcomed), 'lan');
      yield* device.ping();
    }),
  30_000,
);

it.live(
  'main dials through Core’s endpoint, keyed with this computer’s seed, and diagnostics report it bound, accepting and connected',
  () =>
    Effect.gen(function* () {
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-iroh-'));
      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Capabilities.allScopes]]),
          origins: [],
          remotePort: 0,
          userData,
          irohPreset: loopback,
        }),
      );
      const port = (
        Context.get(context, HttpServer.HttpServer).address as { port: number }
      ).port;
      const main = yield* makeCoreClient(coreUrl(port, TOKEN));
      const call = makeHostCaller(main);
      yield* Effect.promise(() =>
        call('remote.set', [{ isEnabled: true, reachesAnywhere: true }]),
      );
      const seed = yield* main['remote.deviceKey']();
      const own = sodium.crypto_sign_seed_keypair(sodium.from_base64(seed));

      const machine = yield* computer;
      const { side } = machineSide(machine.keys, { known: [member(own)] });
      const server = yield* serve(side, port);
      machine.node.accept((link) => server.attach(link, 'iroh'));
      const welcomed = yield* Queue.unbounded<Route['kind']>();
      const follower = yield* makeDeviceClient({
        routes: () => ({
          iroh: {
            kind: 'iroh',
            open: () =>
              irohThroughCore(main, b64(machine.keys.publicKey), {
                addresses: machine.node.sockets(),
              }),
          },
          direct: [],
        }),
        secure: (raw) =>
          secureAsDevice(raw, own, machine.keys.publicKey, 'Mine', true),
        isRefusal: (error) => error instanceof PairingRefused,
        onWelcome: (welcome, route) => {
          assert.equal(welcome.irohRelay, 'https://relay.example/');
          Queue.offerUnsafe(welcomed, route);
        },
        onOffline: () => {},
        onRefused: (reason) => assert.fail(reason),
      });
      assert.equal(yield* Queue.take(welcomed), 'iroh');
      yield* follower.ping();

      const report = JSON.parse(
        (yield* Effect.promise(() => call('remote.diagnostics', []))) as string,
      ) as {
        iroh: {
          status: string;
          endpointId: string;
          isAccepting: boolean;
          relays: unknown;
        };
        events: { message: string }[];
      };
      assert.equal(report.iroh.status, 'bound');
      assert.equal(
        report.iroh.endpointId,
        Buffer.from(own.publicKey).toString('hex'),
      );
      assert.equal(report.iroh.isAccepting, true);
      assert.equal(report.iroh.relays, 'n0');
      const short = Buffer.from(machine.keys.publicKey)
        .toString('hex')
        .slice(0, 10);
      assert.ok(
        report.events.some((e) =>
          e.message.startsWith(`iroh: to ${short} connected`),
        ),
        JSON.stringify(report.events),
      );
      yield* Effect.promise(() => call('remote.set', [{ isEnabled: false }]));
    }),
  30_000,
);
