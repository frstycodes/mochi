import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities as Contract } from '@mochi/schema';
import type { RemoteStatus } from '../../../../apps/desktop/src/host/types/remote.ts';
import { coreUrl, makeCoreClient } from '../client.ts';
import { makeHostCaller } from '../hostClient.ts';
import { Capabilities } from '../hostServer.ts';
import { fileKeys } from '../keys/keyStore.ts';
import { layerCore } from '../server.ts';
import { DEVICE_KEY, deviceSeed } from './service.ts';
import { mintDeviceToken } from './token.ts';

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

/** Main's old `device-key`: `safeStorage` output, faked as `enc:` and the text. */
const legacyKey = (seed: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-device-key-'));
  writeFileSync(path.join(dir, 'device-key'), `enc:${seed}`);
  const keys = fileKeys(dir, {
    isAvailable: () => false,
    seal: async () => assert.fail('no keychain'),
    open: async () => assert.fail('no keychain'),
  });
  return { dir, keys };
};

/** Main's `secureStorage`: decrypts what `legacyKey` wrote. */
const serveKeychain = (capabilities: Capabilities['Service']) =>
  capabilities.serve(['secureStorage']).pipe(
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
    const keys = fileKeys(dir, {
      isAvailable: () => false,
      seal: async () => assert.fail('no keychain'),
      open: async () => assert.fail('no keychain'),
    });
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
