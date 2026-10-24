import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'vite-plus/test';
import { Effect, Exit, Fiber, Layer, Scope } from 'effect';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from './client.ts';
import { layerCore } from './server.ts';

const TOKEN = 'token';

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** Core on `port` until the returned scope closes. */
const startCore = (port: number) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(layerCore({ port, tokens: new Map([[TOKEN, Capabilities.allScopes]]), origins: [] }), scope);
    return scope;
  });

test('calls made while Core restarts succeed once it is back; a call in flight when it drops is sent again', async () => {
  const port = await freePort();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* startCore(port);
        const client = yield* makeCoreClient(coreUrl(port, TOKEN));
        yield* client['docs.set']({ table: 'settings', key: 'agent', value: { model: 'opus' } });
        // In flight when Core goes: `shell` keeps its socket busy, `docs.get` is mid-call while the server closes.
        const inFlight = yield* Effect.forkChild(client['docs.get']({ table: 'settings', key: 'agent' }).pipe(Effect.delay(5)));
        yield* Scope.close(first, Exit.void);
        const during = yield* Effect.forkChild(Effect.all([client.ping(), client['docs.set']({ table: 'settings', key: 'agent', value: { model: 'sonnet' } })]));
        yield* Effect.sleep(600);
        const second = yield* startCore(port);
        yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
        const [pong] = yield* Fiber.join(during);
        assert.equal(pong, 'pong');
        // The restarted Core is in memory: the first value is gone, the one sent during the restart landed.
        yield* Fiber.join(inFlight);
        assert.deepEqual(yield* client['docs.get']({ table: 'settings', key: 'agent' }), { model: 'sonnet' });
      }),
    ),
  );
});
