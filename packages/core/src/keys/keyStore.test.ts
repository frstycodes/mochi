import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
const rawFile = (dir: string) => readFileSync(keysFile(dir), 'utf8');
const withPassphrase = (secret: string | undefined) => ({
  passphrase: () => secret,
});

it.effect(
  'with no keychain but a passphrase, a key round-trips through a 0600 file in a 0700 folder, never in plain text',
  () =>
    Effect.promise(async () => {
      const dir = scratch();
      const keys = fileKeys(dir, noKeychain, withPassphrase('hunter2'));
      assert.equal(await keys.get('session'), undefined);
      await keys.set('session', 'secret-1');
      await keys.set('device', 'secret-2');
      assert.equal(await keys.get('session'), 'secret-1');
      // Windows has no POSIX modes: the file's ACL is the user's profile's.
      if (process.platform !== 'win32') {
        assert.equal(statSync(keysFile(dir)).mode & 0o777, 0o600);
        assert.equal(statSync(path.join(dir, 'keys')).mode & 0o777, 0o700);
      }
      assert.doesNotMatch(rawFile(dir), /secret-|hunter2|"plain"/);
      await keys.delete('session');
      assert.equal(await keys.get('session'), undefined);
      assert.equal(
        await fileKeys(dir, noKeychain, withPassphrase('hunter2')).get(
          'device',
        ),
        'secret-2',
      );
    }),
);

it.effect(
  'a wrong passphrase is an error, for reading and for writing, and a missing one names the variable',
  () =>
    Effect.promise(async () => {
      const dir = scratch();
      await fileKeys(dir, noKeychain, withPassphrase('right')).set(
        'device',
        'secret',
      );
      const wrong = fileKeys(dir, noKeychain, withPassphrase('wrong'));
      await assert.rejects(wrong.get('device'), /doesn’t open the keys/);
      await assert.rejects(wrong.set('other', 'x'), /doesn’t open the keys/);
      await assert.rejects(
        fileKeys(dir, noKeychain, withPassphrase(undefined)).get('device'),
        /set MOCHI_KEY_PASSPHRASE/,
      );
    }),
);

it.effect(
  'with neither a keychain nor a passphrase, a key is kept in memory only and nothing is written',
  () =>
    Effect.promise(async () => {
      const dir = scratch();
      const unsaved: string[] = [];
      const keys = fileKeys(dir, noKeychain, {
        ...withPassphrase(undefined),
        onUnsaved: (name) => unsaved.push(name),
      });
      await keys.set('device', 'secret');
      assert.equal(await keys.get('device'), 'secret');
      assert.deepEqual(unsaved, ['device']);
      assert.doesNotMatch(rawFile(dir), /secret/);
      // A passphrase arriving later puts it on disk, locked.
      await fileKeys(dir, noKeychain, withPassphrase('later')).set('x', 'y');
      assert.match(rawFile(dir), /"device":\{"locked"/);
      assert.doesNotMatch(rawFile(dir), /secret/);
    }),
);

it.effect(
  'a plain entry from an older file is still read, and locked on the next write',
  () =>
    Effect.promise(async () => {
      const dir = scratch();
      mkdirSync(path.join(dir, 'keys'), { recursive: true });
      writeFileSync(
        keysFile(dir),
        JSON.stringify({ keys: { device: { plain: 'old-secret' } } }),
      );
      const keys = fileKeys(dir, noKeychain, withPassphrase('pw'));
      assert.equal(await keys.get('device'), 'old-secret');
      await keys.set('session', 'new');
      assert.doesNotMatch(rawFile(dir), /old-secret|"plain"/);
      assert.equal(await keys.get('device'), 'old-secret');
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
        // Held in memory until a keychain served, then sealed with it.
        assert.deepEqual(saved.keys.before, { sealed: 'os:plain-value' });
        yield* Fiber.interrupt(provider);
      }).pipe(
        Effect.provide(
          KeyStore.layer(served).pipe(Layer.provideMerge(Capabilities.layer)),
        ),
      ),
    ),
);
