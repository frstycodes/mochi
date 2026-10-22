import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { Effect, Exit, Fiber, Layer, Queue, Stream } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { TestClock } from 'effect/testing';
import { Cache } from './cache.ts';
import { makeCoreClient } from './client.ts';
import { Run, RunError } from './run.ts';
import { layerCore } from './server.ts';
import type { CorePort } from './transport.ts';

// Node's port hands `data` straight to `on('message')`; Electron's `MessagePortMain` wraps it in an event.
const asMainPort = (port: MessagePort): CorePort => ({
  postMessage: (message) => port.postMessage(message),
  on: (event: 'message' | 'close', listener: (event: { data: unknown }) => void) =>
    event === 'message' ? port.on('message', (data) => listener({ data })) : port.on('close', listener as () => void),
  start: () => port.start(),
  close: () => port.close(),
});

test('ping and ticks reach a client over a MessagePort', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ports = yield* Queue.unbounded<CorePort>();
        yield* Layer.launch(layerCore(ports)).pipe(Effect.forkScoped);
        const { port1, port2 } = new MessageChannel();
        Queue.offerUnsafe(ports, asMainPort(port1));
        const client = yield* makeCoreClient(asMainPort(port2));
        assert.equal(yield* client.ping(), 'pong');
        const ticks = yield* client.ticks({ intervalMs: 5 }).pipe(Stream.take(3), Stream.runCollect);
        assert.deepEqual([...ticks], [0, 1, 2]);
        port1.close();
      }),
    ),
  );
});

const runPromise = <A, E>(effect: Effect.Effect<A, E, Run>) => Effect.runPromise(effect.pipe(Effect.provide(Run.layer.pipe(Layer.provide(NodeServices.layer)))));

test('interrupting run kills `sleep 100` within 100ms', async () => {
  await runPromise(
    Effect.gen(function* () {
      const { run } = yield* Run;
      const fiber = yield* run('sleep', ['100']).pipe(Effect.forkChild);
      yield* Effect.sleep(200);
      const started = performance.now();
      yield* Fiber.interrupt(fiber);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 100, `interrupt took ${elapsed}ms`);
      assert.equal(childSleeps(), 0);
    }),
  );
});

function childSleeps() {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid), 'sleep']).toString().trim().split('\n').length;
  } catch {
    return 0; // pgrep exits 1 when nothing matches.
  }
}

test('run fails outside okCodes and caps a queue', async () => {
  await runPromise(
    Effect.gen(function* () {
      const { run } = yield* Run;
      const exit = yield* run('sh', ['-c', 'echo nope >&2; exit 3']).pipe(Effect.exit);
      assert.ok(Exit.isFailure(exit) && exit.cause.reasons.some((reason) => reason._tag === 'Fail' && reason.error instanceof RunError && reason.error.code === 3));
      assert.equal((yield* run('sh', ['-c', 'exit 3'], { okCodes: [3] })).code, 3);

      const started = performance.now();
      yield* Effect.all([run('sleep', ['0.2'], { queue: 'lsof' }), run('sleep', ['0.2'], { queue: 'lsof' })], { concurrency: 'unbounded' });
      assert.ok(performance.now() - started >= 400, 'lsof queue ran two at once');
    }),
  );
});

test('cache keeps a success for its TTL and drops failures', async () => {
  let lookups = 0;
  const lookup = Effect.sync(() => ++lookups);
  await Effect.runPromise(
    Effect.gen(function* () {
      const cache = yield* Cache;
      assert.equal(yield* cache.get('a', lookup, '1 minute'), 1);
      assert.equal(yield* cache.get('a', lookup, '1 minute'), 1);
      yield* TestClock.adjust('2 minutes');
      assert.equal(yield* cache.get('a', lookup, '1 minute'), 2);

      yield* cache.get('b', Effect.fail('down'), '1 minute').pipe(Effect.exit);
      assert.equal(yield* cache.get('b', Effect.succeed('up'), '1 minute'), 'up');
    }).pipe(Effect.provide(Layer.provideMerge(Cache.layer, TestClock.layer()))),
  );
});
