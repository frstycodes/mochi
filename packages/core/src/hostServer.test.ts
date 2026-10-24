import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { Capabilities } from './hostServer.ts';

/** A client serving `reactor` that answers each call with its own name, or never answers when `isStuck`. */
const window = (capabilities: Capabilities['Service'], name: string, isStuck = false) =>
  Effect.gen(function* () {
    const got = yield* Deferred.make<void>();
    const fiber = yield* capabilities.serve(['reactor']).pipe(
      Stream.runForEach((call) => Effect.andThen(Deferred.succeed(got, undefined), isStuck ? Effect.void : capabilities.reply({ id: call.id, value: name }))),
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    return { close: Fiber.interrupt(fiber), got: Deferred.await(got) };
  });

const run = (body: Effect.Effect<void, unknown, Capabilities>) => Effect.runPromise(Effect.scoped(body.pipe(Effect.provide(Capabilities.layer))));
const call = { capability: 'reactor', method: 'run', args: [] } as const;

test('closing the window that registered last hands its calls to the one before it, without waiting', async () => {
  await run(
    Effect.gen(function* () {
      const capabilities = yield* Capabilities;
      const first = yield* window(capabilities, 'first');
      const last = yield* window(capabilities, 'last');
      assert.equal(yield* capabilities.call(call), 'last');
      yield* last.close;
      assert.equal(yield* capabilities.call(call).pipe(Effect.timeout('1 second')), 'first');
      yield* first.close;
      assert.match(String(yield* Effect.flip(capabilities.call(call))), /No connected client offers reactor/);
    }),
  );
});

test('a window that closes mid-call hands that call to the next window', async () => {
  await run(
    Effect.gen(function* () {
      const capabilities = yield* Capabilities;
      yield* window(capabilities, 'first');
      const stuck = yield* window(capabilities, 'stuck', true);
      const answer = yield* Effect.forkChild(capabilities.call(call));
      yield* stuck.got;
      yield* stuck.close;
      assert.equal(yield* Fiber.join(answer).pipe(Effect.timeout('1 second')), 'first');
    }),
  );
});
