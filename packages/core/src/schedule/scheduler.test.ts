import { assert, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import type {
  ScheduleEvent,
  TriggerInput,
} from '../../../../apps/desktop/src/host/types/schedule.ts';
import { NodeHttpServer } from '@effect/platform-node';
import { GitHub, GithubTransport } from '../github/service.ts';
import { Run } from '../run.ts';
import { Store } from '../store/store.ts';
import { scheduleHandlers } from './handlers.ts';
import { Scheduler } from './scheduler.ts';

const layer = Scheduler.layer.pipe(
  Layer.provide(GitHub.layer.pipe(Layer.provide(GithubTransport.layer))),
  Layer.provideMerge(Store.layer(':memory:').pipe(Layer.orDie)),
  Layer.provide(Run.layer),
  Layer.provide(NodeHttpServer.layerHttpServices),
);

const input = (cron: string): TriggerInput => ({
  threadId: 't1',
  name: 'Nightly',
  prompt: 'Check',
  when: { kind: 'cron', cron },
  missed: 'run-once',
  start: { provider: 'claude', spaceId: 'work', cwd: '/repo' },
});

const delta = (text: string): ScheduleEvent => ({
  type: 'agent',
  event: { type: 'message', threadId: 't1', isDelta: true, text },
});

it.effect('a trigger is listed once set, paused and removed on request', () =>
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    yield* scheduler.set(input('0 2 * * *'));
    yield* scheduler.setPaused('t1', true);
    const [trigger] = yield* scheduler.list;
    assert.deepStrictEqual(
      [trigger?.threadId, trigger?.isPaused, trigger?.runs.length],
      ['t1', true, 0],
    );
    yield* scheduler.remove('t1');
    assert.strictEqual((yield* scheduler.list).length, 0);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  'an expression that is not cron is refused with the field named',
  () =>
    Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      const message = yield* Effect.flip(scheduler.set(input('61 * * * *')));
      assert.match(message, /minute/);
      assert.strictEqual((yield* scheduler.list).length, 0);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  'kept events drain once, with a run of text deltas folded into one',
  () =>
    Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      yield* scheduler.keep(delta('He'));
      yield* scheduler.keep(delta('llo'));
      const events = yield* scheduler.drain;
      assert.deepStrictEqual(events, [delta('Hello')]);
      assert.strictEqual((yield* scheduler.drain).length, 0);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  'the list a window reads passes its schema, seen PR events left out',
  () =>
    Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      yield* scheduler.set(input('0 2 * * *'));
      const [trigger] = (yield* scheduleHandlers(scheduler)['schedule.list']!(
        [],
      )) as Array<{ threadId: string }>;
      assert.strictEqual(trigger?.threadId, 't1');
      assert.isFalse('seen' in trigger!);
    }).pipe(Effect.provide(layer)),
);
