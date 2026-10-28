import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Effect, Fiber, Layer, Stream } from 'effect';
import { Capabilities } from '../hostServer.ts';
import { fileKeys, KeyStore } from './keyStore.ts';

const noKeychain = {
  isAvailable: () => false,
  seal: async () => assert.fail('no keychain to seal with'),
  open: async () => assert.fail('no keychain to open with'),
};

const scratch = () => mkdtempSync(path.join(tmpdir(), 'mochi-keys-'));
const keysFile = (dir: string) => path.join(dir, 'keys', 'keys.json');

it.effect(
  'with no keychain, a key round-trips through a 0600 file in a 0700 folder',
  () =>
    Effect.promise(async () => {
      const dir = scratch();
      const keys = fileKeys(dir, noKeychain);
      assert.equal(await keys.get('session'), undefined);
      await keys.set('session', 'secret-1');
      await keys.set('device', 'secret-2');
      assert.equal(await keys.get('session'), 'secret-1');
      // Windows has no POSIX modes: the file's ACL is the user's profile's.
      if (process.platform !== 'win32') {
        assert.equal(statSync(keysFile(dir)).mode & 0o777, 0o600);
        assert.equal(statSync(path.join(dir, 'keys')).mode & 0o777, 0o700);
      }
      await keys.delete('session');
      assert.equal(await keys.get('session'), undefined);
      assert.equal(await fileKeys(dir, noKeychain).get('device'), 'secret-2');
    }),
);

it.effect('a key sealed by a keychain refuses to open once none serves', () =>
  Effect.promise(async () => {
    const dir = scratch();
    await fileKeys(dir, {
      isAvailable: () => true,
      seal: async (text) => `sealed:${text}`,
      open: async (sealed) => sealed.slice('sealed:'.length),
    }).set('session', 'secret');
    await assert.rejects(
      fileKeys(dir, noKeychain).get('session'),
      /sealed with this computer's keychain/,
    );
  }),
);

const served = scratch();

it.effect(
  'KeyStore seals through the client serving secureStorage when there is one',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const capabilities = yield* Capabilities;
        const keys = yield* KeyStore;
        yield* Effect.promise(() => keys.set('before', 'plain-value'));
        const provider = yield* capabilities.serve(['secureStorage']).pipe(
          Stream.runForEach((call) =>
            capabilities.reply({
              id: call.id,
              value:
                call.method === 'encrypt'
                  ? `os:${String(call.args[0])}`
                  : String(call.args[0]).slice('os:'.length),
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* Effect.promise(() => keys.set('session', 'secret'));
        assert.equal(
          yield* Effect.promise(() => keys.get('session')),
          'secret',
        );
        assert.equal(
          yield* Effect.promise(() => keys.get('before')),
          'plain-value',
        );
        const saved = JSON.parse(readFileSync(keysFile(served), 'utf8')) as {
          keys: Record<string, unknown>;
        };
        assert.deepEqual(saved.keys.session, { sealed: 'os:secret' });
        assert.deepEqual(saved.keys.before, { plain: 'plain-value' });
        yield* Fiber.interrupt(provider);
      }).pipe(
        Effect.provide(
          KeyStore.layer(served).pipe(Layer.provideMerge(Capabilities.layer)),
        ),
      ),
    ),
);
