import { assert, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import type { TriggerInput } from '../../../../apps/desktop/src/host/types/schedule.ts';
import { NodeHttpServer } from '@effect/platform-node';
import { GitHub, GithubTransport } from '../github/service.ts';
import { Run } from '../run.ts';
import { Store } from '../store/store.ts';
import { scheduleHandlers } from './handlers.ts';
import { logRunStart, Scheduler } from './scheduler.ts';

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

it.effect(
  'a run logs its start, then its thread as starting, so every view shows it until the agent’s first word',
  () =>
    Effect.gen(function* () {
      const store = yield* Store;
      const run = {
        id: 'r1',
        threadId: 't1',
        reason: 'Run now',
        startedAt: 1,
        status: 'running' as const,
      };
      yield* logRunStart(
        store,
        { type: 'run-start', run, name: 'Nightly', prompt: 'Check' },
        'claude',
      );
      const logged = (yield* store.eventsAfter(0))
        .map((e) => (e.payload as { type?: string } | null)?.type)
        .filter((type) => type === 'schedule-run' || type === 'agent-starting');
      assert.deepStrictEqual(logged, ['schedule-run', 'agent-starting']);
    }).pipe(Effect.provide(layer)),
);
