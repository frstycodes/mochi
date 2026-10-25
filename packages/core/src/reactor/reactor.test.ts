import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { COMMAND_TYPE } from '@mochi/domain';
import type { Space } from '../../../../apps/desktop/src/model.ts';
import type { AgentCall } from '../../../../apps/desktop/src/runtime/live.ts';
import type { Action } from '../../../../apps/desktop/src/store/types.ts';
import { GitHub } from '../github/service.ts';
import { Capabilities } from '../hostServer.ts';
import { AgentCaller, Commands } from '../store/commands.ts';
import { Projection } from '../store/projection.ts';
import { Store, type OutboxEffect } from '../store/store.ts';
import { UtilityQueue } from '../utility/queue.ts';
import { layerReactor } from './execute.ts';
import { runReactor } from './reactor.ts';
import type { Outcome } from './worker.ts';

// These commands never reach GitHub.
const noGithub = Layer.succeed(GitHub, {} as GitHub['Service']);

const layerStore = (dir: string) =>
  Projection.layer(undefined).pipe(
    Layer.provideMerge(Store.layer(join(dir, 'mochi.db'))),
    Layer.orDie,
  );

const withCore = <A>(
  dir: string,
  execute: (effect: OutboxEffect) => Effect.Effect<Outcome, unknown>,
  body: Effect.Effect<A, unknown, Store>,
  onForget?: (key: string) => void,
) =>
  Effect.scoped(
    Effect.andThen(runReactor(execute, onForget), body).pipe(
      Effect.provide(layerStore(dir)),
    ),
  );

const command = (
  store: Store['Service'],
  action: Action,
  threadId: string | null = null,
) => store.append({ type: COMMAND_TYPE, threadId, payload: action });
const create: Action = {
  type: 'create',
  spaceId: 's',
  title: 'Ship it',
  provider: 'claude',
  project: null,
  isLive: true,
};
const queued: Action = {
  type: 'queued-add',
  threadId: 'new-1',
  message: {
    id: 'm1',
    draft: 'next',
    mentions: [],
    isCommand: false,
    typedSkills: [],
  },
};
const turnEnd = (store: Store['Service']) =>
  store.append({
    type: 'agent.turn-end',
    threadId: 'new-1',
    payload: { threadId: 'new-1', type: 'turn-end', status: 'done' },
  });

/** A live thread with a message queued behind its turn, then the turn's end: the queue runner's rule asks to send it. */
const queueBehindTurn = (store: Store['Service']) =>
  Effect.all(
    [command(store, create), command(store, queued, 'new-1'), turnEnd(store)],
    { discard: true },
  );

it.effect('a command emitted before a Core restart runs after it, once', () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-reactor-'));
    const taken = yield* Deferred.make<string>();

    // Core takes the command and dies mid-run.
    yield* withCore(
      dir,
      (effect) =>
        effect.type === 'queue.send'
          ? Effect.andThen(Deferred.succeed(taken, effect.type), Effect.never)
          : Effect.void,
      Effect.gen(function* () {
        yield* queueBehindTurn(yield* Store);
        assert.equal(yield* Deferred.await(taken), 'queue.send');
      }),
    );

    const runs: string[] = [];
    const executed = yield* Queue.unbounded<string>();
    yield* withCore(
      dir,
      (effect) =>
        Effect.andThen(
          Effect.sync(() => runs.push(effect.commandId)),
          Queue.offer(executed, effect.commandId),
        ).pipe(Effect.asVoid),
      Effect.gen(function* () {
        const store = yield* Store;
        yield* Queue.take(executed);
        // Due again on the next fold: the rule emits the same key, which the outbox already holds.
        yield* command(
          store,
          { type: 'rename', threadId: 'new-1', title: 'Renamed' },
          'new-1',
        );
        // Folded after the rename, so a second run of its command would be claimed no later than this turn end's idle record.
        const { sequence } = yield* turnEnd(store);
        yield* Stream.fromQueue(executed).pipe(
          Stream.takeUntil((key) => key === `idle:${sequence}`),
          Stream.runDrain,
        );
      }),
    );
    assert.ok(
      runs.filter((key) => key === 'queue:m1').length === 1,
      `ran ${runs.join(', ')}`,
    );
  }),
);

it.effect(
  'a command the executor skips is forgotten: the next fold that shows it due enqueues it again',
  () =>
    Effect.gen(function* () {
      const outcomes: Array<'skipped' | undefined> = ['skipped', undefined];
      const runs: string[] = [];
      const forgotten = yield* Deferred.make<void>();
      const done = yield* Deferred.make<void>();
      yield* withCore(
        mkdtempSync(join(tmpdir(), 'mochi-reactor-')),
        (effect) =>
          effect.type !== 'queue.send'
            ? Effect.void
            : Effect.sync(() => {
                runs.push(effect.commandId);
                return outcomes.shift();
              }).pipe(
                Effect.tap(() =>
                  outcomes.length
                    ? Effect.void
                    : Deferred.succeed(done, undefined),
                ),
              ),
        Effect.gen(function* () {
          const store = yield* Store;
          yield* queueBehindTurn(store);
          yield* Deferred.await(forgotten);
          yield* command(
            store,
            { type: 'rename', threadId: 'new-1', title: 'Renamed' },
            'new-1',
          );
          yield* Deferred.await(done);
        }),
        () => Deferred.doneUnsafe(forgotten, Effect.void),
      );
      assert.deepEqual(runs, ['queue:m1', 'queue:m1']);
    }),
);

it.effect(
  'a queued message goes out with no window open: Core sends it to the agent itself',
  () =>
    Effect.gen(function* () {
      const calls: AgentCall[] = [];
      const sent = yield* Deferred.make<void>();
      const agents = Layer.succeed(AgentCaller, {
        call: (call) =>
          Effect.andThen(
            Effect.sync(() => calls.push(call)),
            call.method === 'send'
              ? Deferred.succeed(sent, undefined)
              : Effect.void,
          ),
        resolve: () => Effect.void,
      });
      const layer = layerReactor.pipe(
        Layer.provideMerge(Commands.layer.pipe(Layer.provide(agents))),
        Layer.provideMerge(
          layerStore(mkdtempSync(join(tmpdir(), 'mochi-reactor-'))),
        ),
        // No window serves anything.
        Layer.provideMerge(
          Layer.mergeAll(Capabilities.layer, UtilityQueue.layer, noGithub),
        ),
      );
      const thread = yield* Effect.gen(function* () {
        const projection = yield* Projection;
        const sendFolded = yield* Effect.forkChild(
          projection.folded.pipe(
            Stream.filter(({ event }) => event.commandId === 'queue:m1:send'),
            Stream.runHead,
          ),
          { startImmediately: true },
        );
        yield* queueBehindTurn(yield* Store);
        yield* Deferred.await(sent);
        yield* Fiber.join(sendFolded);
        return (yield* projection.current).domain.threads.find(
          (t) => t.id === 'new-1',
        )!;
      }).pipe(Effect.provide(layer));
      const sends = calls.filter(
        (c): c is Extract<AgentCall, { method: 'send' }> => c.method === 'send',
      );
      assert.deepEqual(
        sends.map((c) => [c.threadId, c.text]),
        [['new-1', 'next']],
      );
      assert.deepEqual(thread.queued, [], 'the message left the queue');
      assert.equal(thread.activity.at(-1)?.text, 'next');
    }),
);

it.effect(
  'with no window open, a queued message to a thread whose agent is gone starts it with the profile Core holds',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'mochi-reactor-'));
      const profile: Space = {
        id: 's',
        name: 'Side',
        icon: 'rocket',
        plans: { claude: '', codex: '' },
        github: '',
        nativeOff: ['claude:claude-default:skill:user:ui', 'codex:x'],
      };
      // An earlier run: the thread's turn ended, and a window had moved your profiles and prefs into Core.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* Store;
          const { context } = (yield* (yield* Projection).current).domain;
          yield* command(store, {
            type: 'context',
            context: {
              ...context,
              prefs: { ...context.prefs, goals: false },
              profiles: [profile],
            },
          });
          yield* command(store, create);
          yield* turnEnd(store);
        }).pipe(Effect.provide(layerStore(dir))),
      );

      const calls: AgentCall[] = [];
      const started = yield* Deferred.make<void>();
      const agents = Layer.succeed(AgentCaller, {
        call: (call) =>
          Effect.andThen(
            Effect.sync(() => calls.push(call)),
            call.method === 'start'
              ? Deferred.succeed(started, undefined)
              : Effect.void,
          ),
        resolve: () => Effect.void,
      });
      const layer = layerReactor.pipe(
        Layer.provideMerge(Commands.layer.pipe(Layer.provide(agents))),
        Layer.provideMerge(layerStore(dir)),
        // No window serves anything.
        Layer.provideMerge(
          Layer.mergeAll(Capabilities.layer, UtilityQueue.layer, noGithub),
        ),
      );
      yield* Effect.gen(function* () {
        // This run restored the thread with its agent gone (`restoredDomain`).
        yield* command(yield* Store, queued, 'new-1');
        yield* Deferred.await(started);
      }).pipe(Effect.provide(layer));
      const start = calls.find(
        (c): c is Extract<AgentCall, { method: 'start' }> =>
          c.method === 'start',
      )!;
      assert.equal(start.threadId, 'new-1');
      assert.equal(start.options.prompt, 'next');
      assert.equal(start.options.spaceId, 's');
      assert.deepEqual(start.options.nativeOff, [
        'claude:claude-default:skill:user:ui',
      ]);
      assert.equal(start.options.isGoalsOff, true);
      assert.equal(start.options.permissionMode, 'auto', "the thread's Auto");
    }),
);
