import { assert, it } from '@effect/vitest';
import { Deferred, Effect, Fiber } from 'effect';
import { PRIORITY, UtilityQueue } from './queue.ts';

type Queue = UtilityQueue['Service'];

// Started at once, a submit is queued before this fiber moves on, so arrival order is the order of the calls.
const submit = (queue: Queue, thread: string, kind: string, priority: number, run: Effect.Effect<string | null>) =>
  Effect.forkChild(queue.submit({ thread, kind, priority, promptChars: 40, run }), { startImmediately: true });

it.effect('waiting jobs run by priority then arrival, one at a time', () =>
  Effect.gen(function* () {
    const queue = yield* UtilityQueue.make;
    const order: string[] = [];
    let running = 0;
    let peak = 0;
    const record = (name: string) =>
      Effect.gen(function* () {
        peak = Math.max(peak, ++running);
        yield* Effect.yieldNow;
        order.push(name);
        running--;
        return name;
      });
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<string>();
    const held = yield* submit(queue, 'hold', 'hold', 9, Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))));
    yield* Deferred.await(started);
    const rest = [
      yield* submit(queue, 't1', 'simplify', PRIORITY.simplify, record('simplify')),
      yield* submit(queue, 't2', 'audit', PRIORITY.audit, record('audit')),
      yield* submit(queue, 't3', 'classify', PRIORITY.classify, record('classify')),
      yield* submit(queue, 't4', 'audit', PRIORITY.audit, record('audit-later')),
    ];
    yield* Deferred.succeed(release, 'held');
    assert.equal(yield* Fiber.join(held), 'held');
    yield* Fiber.joinAll(rest);
    assert.deepEqual(order, ['classify', 'audit', 'audit-later', 'simplify']);
    assert.equal(peak, 1);
  }),
);

it.effect('a newer job for the same (thread, kind) replaces the older, queued or running', () =>
  Effect.gen(function* () {
    const queue = yield* UtilityQueue.make;
    const started = yield* Deferred.make<void>();
    const running = yield* submit(queue, 't', 'title', 1, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)));
    yield* Deferred.await(started);
    const queued = yield* submit(queue, 'u', 'title', 1, Effect.succeed('old'));
    const blocked = yield* submit(queue, 'v', 'title', 1, Effect.succeed('v'));
    // `queued` waits behind `running`; replacing both lets the newer ones through.
    const newerRunning = yield* submit(queue, 't', 'title', 1, Effect.succeed('new'));
    const newerQueued = yield* submit(queue, 'u', 'title', 1, Effect.succeed('newer'));
    assert.equal(yield* Fiber.join(running), null);
    assert.equal(yield* Fiber.join(queued), null);
    assert.equal(yield* Fiber.join(newerRunning), 'new');
    assert.equal(yield* Fiber.join(newerQueued), 'newer');
    assert.equal(yield* Fiber.join(blocked), 'v');
    const stats = yield* queue.stats;
    assert.equal(stats.replaced, 2);
    assert.ok(stats.tokensIn > 0);
  }),
);
