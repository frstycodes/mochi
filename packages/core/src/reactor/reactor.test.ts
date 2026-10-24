import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Deferred, Effect, Layer } from 'effect';
import { COMMAND_TYPE } from '@mochi/domain';
import type { AgentCall } from '../../../../src/runtime/live.ts';
import type { Action } from '../../../../src/store/types.ts';
import { Capabilities } from '../hostServer.ts';
import { AgentCaller, Commands } from '../store/commands.ts';
import { Projection } from '../store/projection.ts';
import { Store, type OutboxEffect } from '../store/store.ts';
import { UtilityQueue } from '../utility/queue.ts';
import { layerReactor } from './execute.ts';
import { runReactor } from './reactor.ts';

const layerStore = (dir: string) => Projection.layer(undefined).pipe(Layer.provideMerge(Store.layer(join(dir, 'mochi.db'))), Layer.orDie);

const withCore = <A>(dir: string, execute: (effect: OutboxEffect) => Effect.Effect<void, unknown>, body: Effect.Effect<A, unknown, Store>) =>
  Effect.runPromise(Effect.scoped(Effect.andThen(runReactor(execute), body).pipe(Effect.provide(layerStore(dir)))) as Effect.Effect<A>);

const command = (store: Store['Service'], action: Action, threadId: string | null = null) => store.append({ type: COMMAND_TYPE, threadId, payload: action });
const create: Action = { type: 'create', spaceId: 's', title: 'Ship it', provider: 'claude', project: null, isLive: true };
const queued: Action = { type: 'queued-add', threadId: 'new-1', message: { id: 'm1', draft: 'next', mentions: [], isCommand: false, typedSkills: [] } };
const turnEnd = (store: Store['Service']) =>
  store.append({ type: 'agent.turn-end', threadId: 'new-1', payload: { threadId: 'new-1', type: 'turn-end', status: 'done' } });

/** A live thread with a message queued behind its turn, then the turn's end: the queue runner's rule asks to send it. */
const queueBehindTurn = (store: Store['Service']) => Effect.all([command(store, create), command(store, queued, 'new-1'), turnEnd(store)], { discard: true });

test('a command emitted before a Core restart runs after it, once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-reactor-'));
  const taken = Effect.runSync(Deferred.make<string>());

  // Core takes the command and dies mid-run.
  await withCore(
    dir,
    (effect) => (effect.type === 'queue.send' ? Effect.andThen(Deferred.succeed(taken, effect.type), Effect.never) : Effect.void),
    Effect.gen(function* () {
      yield* queueBehindTurn(yield* Store);
      assert.equal(yield* Deferred.await(taken), 'queue.send');
    }),
  );

  const runs: string[] = [];
  const ran = Effect.runSync(Deferred.make<void>());
  await withCore(
    dir,
    (effect) => Effect.andThen(Effect.sync(() => runs.push(effect.commandId)), Deferred.succeed(ran, undefined)),
    Effect.gen(function* () {
      yield* Deferred.await(ran);
      // Due again on the next fold: the rule emits the same key, which the outbox already holds.
      yield* command(yield* Store, { type: 'rename', threadId: 'new-1', title: 'Renamed' }, 'new-1');
      yield* Effect.sleep('200 millis');
    }),
  );
  assert.ok(runs.filter((key) => key === 'queue:m1').length === 1, `ran ${runs.join(', ')}`);
});

test('a command the executor skips is forgotten: the next fold that shows it due enqueues it again', async () => {
  const outcomes: Array<'skipped' | undefined> = ['skipped', undefined];
  const runs: string[] = [];
  const done = Effect.runSync(Deferred.make<void>());
  await withCore(
    mkdtempSync(join(tmpdir(), 'mochi-reactor-')),
    (effect) =>
      effect.type !== 'queue.send'
        ? Effect.void
        : Effect.sync(() => {
            runs.push(effect.commandId);
            return outcomes.shift();
          }).pipe(Effect.tap(() => (outcomes.length ? Effect.void : Deferred.succeed(done, undefined)))),
    Effect.gen(function* () {
      const store = yield* Store;
      yield* queueBehindTurn(store);
      while (runs.length === 0) yield* Effect.sleep('10 millis');
      yield* Effect.sleep('50 millis');
      yield* command(store, { type: 'rename', threadId: 'new-1', title: 'Renamed' }, 'new-1');
      yield* Deferred.await(done);
    }),
  );
  assert.deepEqual(runs, ['queue:m1', 'queue:m1']);
});

test('a queued message goes out with no window open: Core sends it to the agent itself', async () => {
  const calls: AgentCall[] = [];
  const sent = Effect.runSync(Deferred.make<void>());
  const agents = Layer.succeed(AgentCaller, {
    call: (call) => Effect.andThen(Effect.sync(() => calls.push(call)), call.method === 'send' ? Deferred.succeed(sent, undefined) : Effect.void),
    resolve: () => Effect.void,
  });
  const layer = layerReactor.pipe(
    Layer.provideMerge(Commands.layer.pipe(Layer.provide(agents))),
    Layer.provideMerge(layerStore(mkdtempSync(join(tmpdir(), 'mochi-reactor-')))),
    // No window serves anything.
    Layer.provideMerge(Layer.mergeAll(Capabilities.layer, UtilityQueue.layer)),
  );
  const thread = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* queueBehindTurn(yield* Store);
        yield* Deferred.await(sent).pipe(Effect.timeout('5 seconds'));
        yield* Effect.sleep('100 millis');
        return (yield* (yield* Projection).current).domain.threads.find((t) => t.id === 'new-1')!;
      }).pipe(Effect.provide(layer)),
    ) as Effect.Effect<import('../../../../src/model.ts').Thread>,
  );
  const sends = calls.filter((c): c is Extract<AgentCall, { method: 'send' }> => c.method === 'send');
  assert.deepEqual(sends.map((c) => [c.threadId, c.text]), [['new-1', 'next']]);
  assert.deepEqual(thread.queued, [], 'the message left the queue');
  assert.equal(thread.activity.at(-1)?.text, 'next');
});
