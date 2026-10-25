import assert from 'node:assert/strict';
import net from 'node:net';
import { afterEach, it, vi } from '@effect/vitest';
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

/** Watches every socket the client dials from now on; `redialFailed` resolves when the first `armed` one errors. */
function watchDials() {
  let isArmed = false;
  let failed = () => {};
  const redialFailed = new Promise<void>((resolve) => (failed = resolve));
  class Watched extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (isArmed) this.addEventListener('error', () => failed());
    }
  }
  vi.stubGlobal('WebSocket', Watched);
  return { arm: () => (isArmed = true), redialFailed };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.live('calls made while Core restarts succeed once it is back; a call in flight when it drops is sent again', () =>
  Effect.gen(function* () {
    const port = yield* Effect.promise(freePort);
    const dials = watchDials();
    const first = yield* startCore(port);
    const client = yield* makeCoreClient(coreUrl(port, TOKEN));
    yield* client['docs.set']({ table: 'settings', key: 'agent', value: { model: 'opus' } });
    // In flight when Core goes: `shell` keeps its socket busy, `docs.get` is mid-call while the server closes.
    const inFlight = yield* Effect.forkChild(client['docs.get']({ table: 'settings', key: 'agent' }), { startImmediately: true });
    yield* Scope.close(first, Exit.void);
    dials.arm();
    const during = yield* Effect.forkChild(Effect.all([client.ping(), client['docs.set']({ table: 'settings', key: 'agent', value: { model: 'sonnet' } })]));
    yield* Effect.promise(() => dials.redialFailed);
    const second = yield* startCore(port);
    yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
    const [pong] = yield* Fiber.join(during);
    assert.equal(pong, 'pong');
    // The restarted Core is in memory: the first value is gone, the one sent during the restart landed.
    yield* Fiber.join(inFlight);
    assert.deepEqual(yield* client['docs.get']({ table: 'settings', key: 'agent' }), { model: 'sonnet' });
  }),
);
