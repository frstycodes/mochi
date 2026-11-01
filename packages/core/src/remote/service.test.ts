import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from '@effect/vitest';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import sodium from 'libsodium-wrappers';
import WebSocket from 'ws';
import { Capabilities as Contract, type Relay } from '@mochi/schema';
import type { RemoteStatus } from '../../../../apps/desktop/src/host/types/remote.ts';
import { coreUrl, makeCoreClient, type CoreClient } from '../client.ts';
import { makeHostCaller } from '../hostClient.ts';
import { Capabilities } from '../hostServer.ts';
import { fileKeys } from '../keys/keyStore.ts';
import { CoreWsRpcs } from '../rpc.ts';
import { layerCore } from '../server.ts';
import { joinThroughServe, serveFile } from '../serve/login.ts';
import { makeDeviceClient, openLan } from './device.ts';
import { networkHosts } from './interfaces.ts';
import type { Link } from './link.ts';
import { signMember } from './members.ts';
import { PairingRefused, secureAsDevice } from './pairing.ts';
import { DEVICE_KEY, deviceSeed } from './service.ts';
import { mintDeviceToken } from './token.ts';
import { tunnel } from './tunnel.ts';

const TOKEN = 'remote-token';

it.live(
  'remote access answers with no main: status, turning it on listens, and a window command finds no interface',
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Contract.allScopes]]),
          origins: [],
          remotePort: 0,
        }),
      );
      const port = (
        Context.get(context, HttpServer.HttpServer).address as { port: number }
      ).port;
      const call = makeHostCaller(yield* makeCoreClient(coreUrl(port, TOKEN)));
      const host = (tag: string, args: ReadonlyArray<unknown>) =>
        Effect.promise(() => call(tag, args) as Promise<RemoteStatus>);
      const before = yield* host('remote.status', []);
      assert.equal(before.settings.isEnabled, false);
      assert.deepEqual(before.addresses, []);
      const after = yield* host('remote.set', [{ isEnabled: true }]);
      assert.equal(after.error, undefined);
      assert.match(after.addresses[0] ?? '', /^127\.0\.0\.1:[1-9]\d*$/);

      const device = yield* makeCoreClient(
        coreUrl(
          port,
          mintDeviceToken(TOKEN, { id: 'd1', name: 'Phone', scopes: ['read'] }),
        ),
      );
      const result = yield* device['device.command']({
        command: { type: 'catalog' },
      });
      assert.deepEqual(result, {
        isOk: false,
        error: 'No interface is open on this computer',
      });
      yield* host('remote.set', [{ isEnabled: false }]);
    }),
);

const noKeychain = {
  isAvailable: () => false,
  seal: async () => assert.fail('no keychain'),
  open: async () => assert.fail('no keychain'),
};

/** Main's old `device-key`: `safeStorage` output, faked as `enc:` and the text. */
const legacyKey = (seed: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-device-key-'));
  writeFileSync(path.join(dir, 'device-key'), `enc:${seed}`);
  const keys = fileKeys(dir, noKeychain);
  return { dir, keys };
};

/** Main, with its `secureStorage`: decrypts what `legacyKey` wrote. */
const serveKeychain = (capabilities: Capabilities['Service']) =>
  capabilities.serve(['main', 'secureStorage']).pipe(
    Stream.runForEach((call) =>
      capabilities.reply({
        id: call.id,
        value: Buffer.from(String(call.args[0]), 'base64')
          .toString()
          .replace(/^enc:/, ''),
      }),
    ),
    Effect.forkChild,
  );

it.live(
  'the legacy device key moves into Keys through main’s keychain, waiting for main to serve it',
  () =>
    Effect.gen(function* () {
      const capabilities = yield* Capabilities.make;
      const { dir, keys } = legacyKey('c2VlZA');
      let seed: string | undefined;
      const waiting = yield* Deferred.make<void>();
      const reading = deviceSeed(
        keys,
        {
          ...capabilities,
          whenOffered: (name) => {
            Deferred.doneUnsafe(waiting, Effect.void);
            return capabilities.whenOffered(name);
          },
        },
        dir,
      ).then((value) => (seed = value));
      yield* Deferred.await(waiting);
      assert.equal(seed, undefined, 'waits for main rather than a new key');
      assert.ok(existsSync(path.join(dir, 'device-key')));
      const keychain = yield* serveKeychain(capabilities);
      yield* Effect.promise(() => reading);
      assert.equal(seed, 'c2VlZA');
      assert.equal(yield* Effect.promise(() => keys.get(DEVICE_KEY)), 'c2VlZA');
      assert.equal(existsSync(path.join(dir, 'device-key')), false);
      // Read from `Keys` from now on.
      assert.equal(
        yield* Effect.promise(() => deviceSeed(keys, capabilities, dir)),
        'c2VlZA',
      );
      yield* Fiber.interrupt(keychain);
    }),
);

it.live('with no legacy file, a new key is made and kept', () =>
  Effect.gen(function* () {
    const capabilities = yield* Capabilities.make;
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-device-key-'));
    const keys = fileKeys(dir, noKeychain);
    const first = yield* Effect.promise(() =>
      deviceSeed(keys, capabilities, dir),
    );
    assert.equal(yield* Effect.promise(() => keys.get(DEVICE_KEY)), first);
    assert.equal(
      yield* Effect.promise(() => deviceSeed(keys, capabilities, dir)),
      first,
    );
  }),
);

/** A self-signed certificate for `localhost`, as `mochi serve --tls-cert/--tls-key` would get one. */
function selfSigned(dir: string) {
  const [keyFile, certFile] = [
    path.join(dir, 'key.pem'),
    path.join(dir, 'cert.pem'),
  ];
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-subj',
      '/CN=localhost',
      '-days',
      '1',
    ],
    { stdio: 'ignore' },
  );
  return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
}

/** Core's RPC over wss, trusting any certificate: the test's own client, not a tunnel. */
const makeTlsCoreClient = (url: string, token: string) =>
  Effect.flatMap(
    Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(
          Socket.layerWebSocket(url, {
            protocols: Contract.subprotocolsFor(token),
          }),
        ),
        Layer.provide(
          Layer.succeed(Socket.WebSocketConstructor)(
            (address, options) =>
              new WebSocket(
                address,
                Array.isArray(options) || typeof options === 'string'
                  ? options
                  : options?.protocols,
                { rejectUnauthorized: false },
              ) as unknown as Socket.WebSocketLike,
          ),
        ),
        Layer.provide(RpcSerialization.layerJson),
      ),
    ),
    (context) => RpcClient.make(CoreWsRpcs).pipe(Effect.provide(context)),
  );

/** Core's RPC `ping` as a device sends it through its link. */
const PING = JSON.stringify({
  _tag: 'Request',
  id: '1',
  tag: 'ping',
  payload: null,
  headers: [],
});

/** One tunnel into Core carrying `PING`: Core's first reply, or why the link closed. */
const probeTunnel = (url: string, token: string, ca?: Buffer) =>
  new Promise<string>((resolve) => {
    let deliver: (text: string) => void = () => {};
    const link: Link = {
      send: resolve,
      close: (_code, reason) => resolve(`closed: ${reason}`),
      onMessage: (listener) => (deliver = listener),
      onClose: () => {},
      isOpen: () => true,
    };
    tunnel(link, {
      url,
      token,
      ...(ca && { ca }),
      onMalformed: (frame) => assert.fail(frame),
    });
    deliver(PING);
  });

it.live(
  'a Core serving TLS on a non-loopback host lets a paired device’s tunnel reach it',
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => sodium.ready);
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-remote-tls-'));
      const tls = selfSigned(userData);
      // A LAN address when there is one; every interface otherwise. Neither is the certificate's name.
      const host = networkHosts().find((a) => !a.includes(':')) ?? '0.0.0.0';
      const dialed = host === '0.0.0.0' ? '127.0.0.1' : host;

      // This computer's key, and the phone a member before Core starts.
      const seed = sodium.to_base64(
        sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES),
      );
      yield* Effect.promise(() =>
        fileKeys(userData, noKeychain).set(DEVICE_KEY, seed),
      );
      const machineKeys = sodium.crypto_sign_seed_keypair(
        sodium.from_base64(seed),
      );
      const deviceKeys = sodium.crypto_sign_keypair();
      const phone = signMember(
        machineKeys,
        {
          publicKey: sodium.to_base64(
            deviceKeys.publicKey,
            sodium.base64_variants.ORIGINAL,
          ),
          name: 'Phone',
        },
        1,
      );
      writeFileSync(
        path.join(userData, 'devices.json'),
        JSON.stringify({
          machineId: 'tls-machine',
          records: [phone],
          devices: [],
          machines: [],
        }),
      );
      writeFileSync(
        path.join(userData, 'remote.json'),
        JSON.stringify({ isEnabled: true }),
      );

      const context = yield* Layer.build(
        layerCore({
          port: 0,
          host,
          tls,
          userData,
          tokens: new Map([[TOKEN, Contract.allScopes]]),
          origins: [],
          remotePort: 0,
        }),
      );
      const { port } = Context.get(context, HttpServer.HttpServer).address as {
        port: number;
      };
      const coreAddress = `wss://${dialed}:${port}/ws?v=${Contract.PROTOCOL_VERSION}`;
      const call = makeHostCaller(
        (yield* makeTlsCoreClient(coreAddress, TOKEN)) as unknown as CoreClient,
      );
      const hostCall = (tag: string, args: ReadonlyArray<unknown>) =>
        Effect.promise(() => call(tag, args) as Promise<RemoteStatus>);
      // Listening, with the phone a member, once `start` has read the files.
      const readStatus = () =>
        call('remote.status', []) as Promise<RemoteStatus>;
      yield* Effect.promise(() =>
        expect
          .poll(readStatus)
          .toSatisfy((s) => s.addresses.length > 0 && s.members.length > 0),
      );
      const status = yield* Effect.promise(readStatus);
      assert.deepEqual(
        status.members.map((m) => m.name),
        ['Phone'],
      );

      const welcomes: Relay.WelcomeFrame[] = [];
      const device = yield* makeDeviceClient({
        routes: () => ({
          direct: [{ kind: 'lan', open: () => openLan(status.addresses[0]!) }],
        }),
        secure: (raw) =>
          secureAsDevice(raw, deviceKeys, machineKeys.publicKey, 'Phone', true),
        isRefusal: (error) => error instanceof PairingRefused,
        onWelcome: (welcome) => void welcomes.push(welcome),
        onOffline: () => {},
        onRefused: (reason) => assert.fail(reason),
      });
      assert.equal(yield* device.ping(), 'pong');
      assert.equal(welcomes.length, 1);
      assert.equal(welcomes[0]!.type, 'welcome');

      // Core's certificate is what the tunnel trusts: without it the same tunnel never opens.
      const token = mintDeviceToken(TOKEN, {
        id: 'probe',
        name: 'Probe',
        scopes: ['read'],
      });
      assert.match(
        yield* Effect.promise(() => probeTunnel(coreAddress, token, tls.cert)),
        /pong/,
      );
      assert.match(
        yield* Effect.promise(() => probeTunnel(coreAddress, token)),
        /^closed: /,
      );
      yield* hostCall('remote.set', [{ isEnabled: false }]);
    }),
);

it.live(
  'on the desktop remote access waits for main before it starts, so the keychain-sealed account is read signed in',
  () =>
    Effect.gen(function* () {
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-wait-main-'));
      writeFileSync(
        path.join(userData, 'remote.json'),
        JSON.stringify({ isEnabled: true }),
      );
      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Contract.allScopes]]),
          origins: [],
          remotePort: 0,
          userData,
          hasKeychain: true,
        }),
      );
      const port = (
        Context.get(context, HttpServer.HttpServer).address as { port: number }
      ).port;
      const main = yield* makeCoreClient(coreUrl(port, TOKEN));
      const call = makeHostCaller(main);
      const readStatus = () =>
        call('remote.status', []) as Promise<RemoteStatus>;
      const isListening = (s: RemoteStatus) => s.addresses.length > 0;
      const listenedEarly = yield* Effect.promise(() =>
        expect
          .poll(readStatus, { timeout: 300 })
          .toSatisfy(isListening)
          .then(
            () => true,
            () => false,
          ),
      );
      assert.equal(listenedEarly, false, 'not before main');
      yield* main['capabilities.serve']({ names: ['main'] }).pipe(
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* Effect.promise(() =>
        expect.poll(readStatus).toSatisfy(isListening),
      );
      yield* Effect.promise(() => call('remote.set', [{ isEnabled: false }]));
    }),
);

it.live(
  'where main can’t seal (Linux `basic_text`) it offers no `secureStorage`: with no passphrase the key stays in memory, never on disk in plain text, and remote access starts',
  () =>
    Effect.gen(function* () {
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-weak-keyring-'));
      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tokens: new Map([[TOKEN, Contract.allScopes]]),
          origins: [],
          remotePort: 0,
          userData,
          hasKeychain: true,
        }),
      );
      const port = (
        Context.get(context, HttpServer.HttpServer).address as { port: number }
      ).port;
      const main = yield* makeCoreClient(coreUrl(port, TOKEN));
      yield* main['capabilities.serve']({ names: ['main'] }).pipe(
        Stream.runDrain,
        Effect.forkChild,
      );
      const seed = yield* main['remote.deviceKey']();
      const file = readFileSync(
        path.join(userData, 'keys', 'keys.json'),
        'utf8',
      );
      assert.ok(seed);
      assert.ok(!file.includes(seed), 'the device key is not on disk');
      assert.equal(
        (JSON.parse(file) as { keys: Record<string, unknown> }).keys[
          DEVICE_KEY
        ],
        undefined,
      );
      assert.equal(yield* main['remote.deviceKey'](), seed, 'held in memory');
      const call = makeHostCaller(main);
      const status = (yield* Effect.promise(() =>
        call('remote.set', [{ isEnabled: true }]),
      )) as RemoteStatus;
      assert.equal(status.error, undefined);
      assert.match(status.addresses[0] ?? '', /^127\.0\.0\.1:[1-9]\d*$/);
      yield* Effect.promise(() => call('remote.set', [{ isEnabled: false }]));
    }),
);

it.live(
  '`mochi login` follows a TLS `mochi serve`, trusting only the certificate `serve.json` names',
  () =>
    Effect.gen(function* () {
      const userData = mkdtempSync(path.join(tmpdir(), 'mochi-login-tls-'));
      const tls = selfSigned(userData);
      const context = yield* Layer.build(
        layerCore({
          port: 0,
          tls,
          userData,
          tokens: new Map([[TOKEN, Contract.allScopes]]),
          origins: [],
          remotePort: 0,
        }),
      );
      const { port } = Context.get(context, HttpServer.HttpServer).address as {
        port: number;
      };
      writeFileSync(
        serveFile(userData),
        JSON.stringify({
          pid: process.pid,
          url: `wss://127.0.0.1:${port}/ws?v=${Contract.PROTOCOL_VERSION}`,
          token: TOKEN,
          certFile: path.join(userData, 'cert.pem'),
        }),
      );
      // Reaching Core is what this checks: signed out, its join answers why.
      const refused = yield* Effect.flip(joinThroughServe(userData));
      assert.match(refused.message, /Not signed in/);
    }),
);
