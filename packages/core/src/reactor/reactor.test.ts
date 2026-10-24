import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Deferred, Effect, Layer } from 'effect';
import { Store, type OutboxEffect } from '../store/store.ts';
import { runReactor } from './reactor.ts';

const withCore = <A>(dir: string, execute: (effect: OutboxEffect) => Effect.Effect<void, unknown>, body: Effect.Effect<A, unknown, Store>) =>
  Effect.runPromise(Effect.scoped(Effect.andThen(runReactor(execute), body).pipe(Effect.provide(Store.layer(join(dir, 'mochi.db')).pipe(Layer.orDie)))) as Effect.Effect<A>);

/** A live, idle thread with one queued message: the queue runner's rule asks to send it. */
const save = (store: Store['Service']) => {
  const thread = { id: 't1', title: 't1', spaceId: 's', status: 'running', goal: '', activity: [], providers: ['claude'], live: { isWorking: false }, queued: [{ id: 'm1', draft: 'next' }] };
  return store.saveThreads(JSON.stringify({ version: 1, queue: [], threadIds: ['t1'] }), { t1: JSON.stringify({ thread }) });
};

test('a command emitted before a Core restart runs after it, once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-reactor-'));

  // Core takes the command and dies mid-run: the window got it, but Core never heard back.
  await withCore(
    dir,
    (effect) => Effect.andThen(Deferred.succeed(taken, effect.type), Effect.never),
    Effect.gen(function* () {
      yield* save(yield* Store);
      assert.equal(yield* Deferred.await(taken), 'queue.send');
    }),
  );

  const runs: string[] = [];
  const ran = Effect.runSync(Deferred.make<void>());
  await withCore(
    dir,
    (effect) => Effect.andThen(Effect.sync(() => runs.push((effect.payload as { messageId: string }).messageId)), Deferred.succeed(ran, undefined)),
    Effect.gen(function* () {
      yield* Deferred.await(ran);
      // The same save again: the rule emits the same key, which the outbox already holds.
      yield* save(yield* Store);
      yield* Effect.sleep('200 millis');
    }),
  );
  assert.deepEqual(runs, ['m1']);
});

test('a command the executor skips is forgotten: the next save that shows it due enqueues it again', async () => {
  const outcomes: Array<'skipped' | undefined> = ['skipped', undefined];
  const runs: string[] = [];
  const done = Effect.runSync(Deferred.make<void>());
  await withCore(
    mkdtempSync(join(tmpdir(), 'mochi-reactor-')),
    (effect) =>
      Effect.sync(() => {
        runs.push(effect.commandId);
        return outcomes.shift();
      }).pipe(Effect.tap(() => (outcomes.length ? Effect.void : Deferred.succeed(done, undefined)))),
    Effect.gen(function* () {
      const store = yield* Store;
      yield* save(store);
      while (runs.length === 0) yield* Effect.sleep('10 millis');
      yield* Effect.sleep('50 millis');
      yield* save(store);
      yield* Deferred.await(done);
    }),
  );
  assert.deepEqual(runs, ['queue:m1', 'queue:m1']);
});

const taken = Effect.runSync(Deferred.make<string>());
