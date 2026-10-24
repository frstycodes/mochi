import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '../client.ts';
import { layerCore } from '../server.ts';
import { emitAgentEvent } from './events.ts';

const TOKEN = 'main-token';

const isProbe = (item: { payload: unknown }) => (item.payload as { threadId?: string }).threadId === 'probe';

test("main's push stream carries agent events whole, a field the adapter left undefined included", { timeout: 60_000 }, async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layerCore({ port: 0, tokens: new Map([[TOKEN, Capabilities.allScopes]]), origins: [] }));
        const port = (Context.get(context, HttpServer.HttpServer).address as { port: number }).port;
        const main = yield* makeCoreClient(coreUrl(port, TOKEN));
        const isSubscribed = yield* Deferred.make<void>();
        const events = main.agentPush().pipe(
          Stream.filter((item) => item.channel === 'agent:onEvent'),
          Stream.tap((item) => (isProbe(item) ? Deferred.succeed(isSubscribed, undefined) : Effect.void)),
          Stream.filter((item) => !isProbe(item)),
          Stream.take(3),
          Stream.runCollect,
        );
        const received = yield* Effect.forkScoped(events);
        // The subscription opens over a socket, so no fixed sleep covers a slow runner; events sent before it are dropped.
        const probe = Effect.sync(() => emitAgentEvent({ threadId: 'probe', type: 'session', provider: 'claude', sessionId: 'probe' }));
        yield* Effect.raceFirst(Deferred.await(isSubscribed), Effect.forever(Effect.andThen(probe, Effect.sleep(50))));
        // Adapters build events with optional fields set to undefined (an info without a model, a tool without output).
        emitAgentEvent({ threadId: 'p', type: 'session', provider: 'claude', sessionId: 's1' });
        emitAgentEvent({ threadId: 'p', type: 'info', info: { model: undefined, cwd: '/tmp' } });
        emitAgentEvent({ threadId: 'p', type: 'turn-end', status: 'done' });
        const items = [...(yield* Fiber.join(received))];
        assert.deepEqual(items.map((item) => (item.payload as { type: string }).type), ['session', 'info', 'turn-end']);
        assert.deepEqual((items[1]!.payload as { info: unknown }).info, { cwd: '/tmp' });
      }),
    ),
  );
});
