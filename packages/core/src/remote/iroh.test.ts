import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Context, Effect, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import sodium from 'libsodium-wrappers';
import {
  Endpoint,
  EndpointAddr,
  RelayMode,
  SecretKey,
  presetMinimal,
} from '@number0/iroh';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '../client.ts';
import { layerCore } from '../server.ts';
import { makeDeviceClient } from './device.ts';
import { acceptIroh, dialIroh, IROH_ALPN } from './iroh.ts';
import type { RawLink } from './link.ts';
import {
  deviceId,
  PairingRefused,
  secureAsDevice,
  secureAsMachine,
  type MachineSide,
} from './pairing.ts';
import { startRemoteServer } from './server.ts';
import { mintDeviceToken } from './token.ts';
import type { DeviceKeys } from './session.ts';
import type { Scope } from '../../../../apps/desktop/src/host/types/remote.ts';

await sodium.ready;

const TOKEN = 'core-token';
const keypair = (): DeviceKeys => sodium.crypto_sign_keypair();

/** Offline on loopback: no relay, no discovery, so the dialler is given the listener's bound address. */
const bindLocal = Effect.acquireRelease(
  Effect.promise(() => {
    const builder = Endpoint.builder();
    presetMinimal(builder);
    builder.relayMode(RelayMode.disabled());
    builder.alpns([IROH_ALPN]);
    builder.bindAddr('127.0.0.1:0');
    return builder.bind();
  }),
  (endpoint) => Effect.promise(() => endpoint.close()),
);
const addrOf = (endpoint: Endpoint) =>
  new EndpointAddr(endpoint.id(), null, endpoint.boundSockets());

/** Two endpoints, the machine handing each accepted link to `onLink`, and one dialled link from the device. */
const linked = (onLink: (raw: RawLink) => void) =>
  Effect.gen(function* () {
    const machine = yield* bindLocal;
    const device = yield* bindLocal;
    void acceptIroh(machine, onLink);
    return {
      machine,
      device,
      dial: () => dialIroh(device, addrOf(machine)),
    };
  });

const closedWith = (raw: RawLink) =>
  new Promise<[number, string]>((resolve) =>
    raw.onClose((code, reason) => resolve([code, reason])),
  );

it.live(
  'frames survive QUIC chunking in order, and a close reaches the peer after what was sent, with its code and reason',
  () =>
    Effect.gen(function* () {
      const received: Uint8Array[] = [];
      let machineSide!: Promise<[number, string]>;
      const { dial } = yield* linked((raw) => {
        machineSide = closedWith(raw);
        raw.onMessage((bytes) => {
          received.push(bytes);
          if (received.length === 3) raw.close(4401, 'Refused');
        });
      });
      const raw = yield* Effect.promise(dial);
      const big = sodium.randombytes_buf(900 * 1024);
      raw.send(new Uint8Array([1, 2, 3]));
      raw.send(big);
      raw.send(new Uint8Array(0));
      const [code, reason] = yield* Effect.promise(() => closedWith(raw));
      assert.deepEqual([code, reason], [4401, 'Refused']);
      assert.deepEqual(yield* Effect.promise(() => machineSide), [
        4401,
        'Refused',
      ]);
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
  'an unknown device is refused over iroh: the refusal frame arrives before the close',
  () =>
    Effect.gen(function* () {
      const machineKeys = keypair();
      const side: MachineSide = {
        keys: machineKeys,
        find: () => undefined,
        refresh: async () => {},
        approve: async () => false,
        add: async () => undefined,
      };
      const { dial } = yield* linked(
        (raw) =>
          void secureAsMachine(raw, 'relay', side).then(
            (secured) => 'refusal' in secured && raw.close(4401, 'Refused'),
          ),
      );
      const raw = yield* Effect.promise(dial);
      const refused = yield* Effect.promise(() =>
        secureAsDevice(
          raw,
          keypair(),
          machineKeys.publicKey,
          'Laptop',
          true,
        ).then(
          () => undefined,
          (error: unknown) => error,
        ),
      );
      assert.ok(refused instanceof PairingRefused, String(refused));
    }),
);

it.live(
  'a paired device reads the same `thread` stream a window does, over iroh, with pairing and the tunnel unchanged',
  () =>
    Effect.gen(function* () {
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
      const machineKeys = keypair();
      const deviceKeys = keypair();
      const device = {
        id: deviceId(deviceKeys.publicKey),
        name: 'Laptop',
        publicKey: sodium.to_base64(
          deviceKeys.publicKey,
          sodium.base64_variants.ORIGINAL,
        ),
        scopes: ['read', 'operate', 'manage', 'code'] satisfies Scope[],
        pairedAt: 1,
      };
      const side: MachineSide = {
        keys: machineKeys,
        find: (id) => (id === device.id ? device : undefined),
        refresh: async () => {},
        approve: async () => false,
        add: async () => undefined,
      };
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startRemoteServer({
            hosts: [],
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
            onRejected: (_device, reason) => assert.fail(reason),
          }),
        ),
        (server) => Effect.promise(() => server.close()),
      );
      const { dial } = yield* linked((raw) => server.attach(raw));
      const welcomed: string[] = [];
      const client = yield* makeDeviceClient({
        routes: () => ({ direct: [{ kind: 'lan', open: dial }] }),
        secure: (raw) =>
          secureAsDevice(
            raw,
            deviceKeys,
            machineKeys.publicKey,
            'Laptop',
            true,
          ),
        isRefusal: (error) => error instanceof PairingRefused,
        onWelcome: (welcome) => void welcomed.push(welcome.backend.name),
        onOffline: () => {},
        onRefused: (reason) => assert.fail(reason),
      });

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
        [firstSnapshot(window), firstSnapshot(client)],
        { concurrency: 'unbounded' },
      );
      assert.deepEqual([...fromDevice], [...fromWindow]);
      assert.equal(
        (
          [...fromDevice][0] as {
            saved: { thread: { title: string } };
          }
        ).saved.thread.title,
        'Fix login',
      );
      assert.deepEqual(welcomed, ['Studio']);
    }),
);
