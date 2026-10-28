import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities as Contract } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '../client.ts';
import { Capabilities } from '../hostServer.ts';
import { layerCore } from '../server.ts';
import { Backend, osKind } from './backend.ts';

const READ = ['read'] as const;

const layer = Backend.layer({ kind: 'mac' }).pipe(
  Layer.provideMerge(Capabilities.layer),
);

it.effect(
  'the descriptor lists the capabilities a client serves, and only while it does',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backend = yield* Backend;
        const capabilities = yield* Capabilities;
        const before = yield* backend.describe(READ);
        assert.deepEqual(before.capabilities, []);
        assert.deepEqual(before.scopes, ['read']);
        assert.equal(before.kind, 'mac');
        assert.equal(before.protocolVersion, Contract.PROTOCOL_VERSION);

        const window = yield* capabilities
          .serve(['notify', 'sim'])
          .pipe(Stream.runDrain, Effect.forkChild);
        yield* Effect.yieldNow;
        assert.deepEqual(
          [...(yield* backend.describe(READ)).capabilities].sort(),
          ['notify', 'sim'],
        );
        yield* Fiber.interrupt(window);
        assert.deepEqual((yield* backend.describe(READ)).capabilities, []);
      }).pipe(Effect.provide(layer)),
    ),
);

it.effect(
  'the watch pushes the descriptor again on a capability change and on a rename, and not otherwise',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const backend = yield* Backend;
        const capabilities = yield* Capabilities;
        const pushed = yield* Queue.unbounded<{
          name: string;
          id: string;
          capabilities: ReadonlyArray<string>;
        }>();
        yield* backend.watch(READ).pipe(
          Stream.runForEach((info) => Queue.offer(pushed, info)),
          Effect.forkScoped,
        );
        const first = yield* Queue.take(pushed);
        assert.deepEqual(first.capabilities, []);

        const window = yield* capabilities
          .serve(['browserView'])
          .pipe(Stream.runDrain, Effect.forkChild);
        assert.deepEqual((yield* Queue.take(pushed)).capabilities, [
          'browserView',
        ]);

        yield* backend.identify({ id: 'machine-1', name: 'Studio' });
        const renamed = yield* Queue.take(pushed);
        assert.equal(renamed.name, 'Studio');
        assert.equal(renamed.id, 'machine-1');

        // The same identity again changes nothing, so nothing is pushed; the next push is the window leaving.
        yield* backend.identify({ name: 'Studio' });
        yield* Fiber.interrupt(window);
        assert.deepEqual((yield* Queue.take(pushed)).capabilities, []);
      }).pipe(Effect.provide(layer)),
    ),
);

it('the desktop names the OS it runs on', () => {
  assert.deepEqual(
    (['darwin', 'win32', 'linux', 'freebsd'] as const).map(osKind),
    ['mac', 'windows', 'linux', 'linux'],
  );
});

const TOKEN = 'backend-token';

/** Core as `mochi serve` runs it: no `backend` option, and no client serving anything. */
const startHeadless = (scopes: ReadonlyArray<Contract.AuthScope>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      layerCore({ port: 0, tokens: new Map([[TOKEN, scopes]]), origins: [] }),
    );
    const { port } = Context.get(context, HttpServer.HttpServer).address as {
      port: number;
    };
    return yield* makeCoreClient(coreUrl(port, TOKEN));
  });

it.live(
  'a headless Core says server, offers nothing a shell serves, and reports the connection’s scopes',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* startHeadless(['read']);
        const info = yield* client['backend.info']();
        assert.equal(info.kind, 'server');
        assert.deepEqual(info.capabilities, []);
        assert.deepEqual(info.scopes, ['read']);
        assert.equal(info.protocolVersion, Contract.PROTOCOL_VERSION);
        assert.ok(info.id && info.name && info.appVersion);
        // A device holding only `read` may ask who this is, but not change it.
        const refused = yield* Effect.flip(
          client['backend.identify']({ name: 'Mine' }),
        );
        assert.equal((refused as { _tag?: string })._tag, 'Unauthorized');
      }),
    ),
);

it.live(
  'a client that registers a capability appears in the descriptor over the socket',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* startHeadless(Contract.allScopes);
        const window = yield* client['capabilities.serve']({
          names: ['notify'],
        }).pipe(Stream.runDrain, Effect.forkChild);
        const seen = yield* client['backend.watch']().pipe(
          Stream.filter((info) => info.capabilities.includes('notify')),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout('5 seconds'),
        );
        assert.equal(seen.length, 1);
        yield* Fiber.interrupt(window);
      }),
    ),
);
