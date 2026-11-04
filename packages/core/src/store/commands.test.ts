import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { Deferred, Effect, Layer, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { actionOf, COMMAND_TYPE, type ReplicaItem } from '@mochi/domain';
import {
  NO_AGENT_PROCESS,
  type AgentEvent,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { AgentCall } from '../../../../apps/desktop/src/runtime/live.ts';
import { applyFrame } from '../../../../apps/desktop/src/remote/mirror.ts';
import { createReplica } from '../../../../apps/desktop/src/store/replica.ts';
import { mirrorState } from '../../../../apps/desktop/src/store/root.ts';
import type { Action } from '../../../../apps/desktop/src/store/types.ts';
import { AgentCaller, AgentError, Commands } from './commands.ts';
import { Projection } from './projection.ts';
import { Store } from './store.ts';

const create: Action = {
  type: 'create',
  spaceId: 's',
  title: 'Ship it',
  provider: 'claude',
  project: null,
  isLive: true,
};

const layerStore = () =>
  Projection.layer(undefined).pipe(
    Layer.provideMerge(
      Store.layer(
        join(mkdtempSync(join(tmpdir(), 'mochi-commands-')), 'mochi.db'),
      ),
    ),
    Layer.orDie,
  );

const agentEvent = (store: Store['Service'], event: AgentEvent) =>
  store.append({
    type: `agent.${event.type}`,
    threadId: event.threadId,
    payload: event,
  });

it.effect('Core logs a thread as starting before it makes the start call', () =>
  Effect.gen(function* () {
    const startedAfter = yield* Deferred.make<ReadonlyArray<Action>>();
    const layer = Layer.unwrap(
      Effect.gen(function* () {
        const store = yield* Store;
        return Commands.layer.pipe(
          Layer.provide(
            Layer.succeed(AgentCaller, {
              call: (call: AgentCall) =>
                call.method === 'start'
                  ? store.eventsAfter(0).pipe(
                      Effect.map((events) =>
                        events.flatMap((e) => actionOf(e) ?? []),
                      ),
                      Effect.flatMap((logged) =>
                        Deferred.succeed(startedAfter, logged),
                      ),
                      Effect.orDie,
                    )
                  : Effect.void,
              resolve: () => Effect.void,
            }),
          ),
        );
      }),
    ).pipe(Layer.provideMerge(layerStore()));
    const logged = yield* Effect.gen(function* () {
      yield* (yield* Commands).apply(create);
      return yield* Deferred.await(startedAfter);
    }).pipe(Effect.provide(layer));
    assert.ok(
      logged.some((a) => a.type === 'agent-starting'),
      `logged before the start: ${logged.map((a) => a.type).join(', ')}`,
    );
  }),
);

/** Core with `call` as its agents; `calls` records each in order. */
const withAgents = (
  call: (agentCall: AgentCall) => Effect.Effect<unknown, AgentError>,
) => {
  const calls: AgentCall[] = [];
  const layer = Commands.layer.pipe(
    Layer.provide(
      Layer.succeed(AgentCaller, {
        call: (agentCall: AgentCall) =>
          Effect.andThen(
            Effect.sync(() => calls.push(agentCall)),
            call(agentCall),
          ),
        resolve: () => Effect.void,
      }),
    ),
    Layer.provideMerge(layerStore()),
  );
  return { calls, layer };
};

/** Every action and agent event in Core's log, in order, as `type` (an agent event as `agent.<type>`). */
const loggedTypes = Effect.gen(function* () {
  const events = yield* (yield* Store).eventsAfter(0);
  return events.flatMap((e) => {
    const action = actionOf(e);
    if (!action) return [];
    return action.type === 'agent'
      ? [`agent.${action.event.type}`]
      : [action.type];
  });
});

it.effect(
  'a send that finds the agent’s process gone starts it again with the same message, logged as starting',
  () =>
    Effect.gen(function* () {
      const { calls, layer } = withAgents((agentCall) =>
        agentCall.method === 'send'
          ? Effect.fail(new AgentError({ message: NO_AGENT_PROCESS }))
          : Effect.void,
      );
      const types = yield* Effect.gen(function* () {
        const commands = yield* Commands;
        yield* commands.apply(create);
        yield* commands.apply({
          type: 'send',
          threadId: 'new-1',
          text: 'and the tests',
        });
        return yield* loggedTypes;
      }).pipe(Effect.provide(layer));
      assert.deepEqual(
        calls.map((c) => c.method),
        ['start', 'send', 'start'],
      );
      const resumed = calls[2] as Extract<AgentCall, { method: 'start' }>;
      assert.equal(resumed.options.prompt, 'and the tests');
      assert.deepEqual(types.slice(-2), ['send', 'agent-starting']);
    }),
);

it.effect(
  'a call that fails ends the turn as failed, with the agent’s words',
  () =>
    Effect.gen(function* () {
      const { layer } = withAgents(() =>
        Effect.fail(
          new AgentError({ message: 'Claude Code is not installed' }),
        ),
      );
      const error = yield* Effect.gen(function* () {
        yield* (yield* Commands).apply(create);
        const events = yield* (yield* Store).eventsAfter(0);
        return (events.at(-1)!.payload as { error?: string }).error;
      }).pipe(Effect.provide(layer));
      assert.equal(error, 'Claude Code is not installed');
    }),
);

it.effect(
  'a slow start holds up no command behind it, only that command’s calls',
  () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const { calls, layer } = withAgents((agentCall) =>
        agentCall.method === 'start' ? Deferred.await(release) : Effect.void,
      );
      const types = yield* Effect.gen(function* () {
        const commands = yield* Commands;
        const first = yield* commands.submit(create);
        // Logged while the start still waits on its worktree.
        yield* commands.submit({
          type: 'rename',
          threadId: 'new-1',
          title: 'Renamed',
        });
        const logged = yield* loggedTypes;
        yield* Deferred.succeed(release, undefined);
        yield* first.done;
        return logged;
      }).pipe(Effect.provide(layer));
      assert.ok(types.includes('rename'), types.join(', '));
      assert.equal(calls[0]?.method, 'start');
    }),
);

it.effect(
  'another computer folding Core’s stream sees the start end at the agent’s first word',
  () =>
    Effect.gen(function* () {
      const store = yield* Store;
      const projection = yield* Projection;
      // What `connectRemote` builds for another computer's Core (src/backends/remote.ts), fed Core's stream from the start.
      let deliver: (item: ReplicaItem) => void = () => {};
      const following = createReplica(
        {
          follow: (_after, onItem) => {
            deliver = onItem;
            return () => {};
          },
          append: () => Promise.reject(new Error('read only')),
        },
        (saved) =>
          mirrorState(
            saved ?? {
              version: 1,
              now: 0,
              seq: 0,
              threads: [],
              queue: [],
              checkpoints: {},
              checkpointSeq: 0,
              forks: {},
            },
          ),
        (run) => (run(), () => {}),
      );
      yield* Effect.forkChild(
        Stream.runForEach(projection.replica(0), (item) =>
          Effect.sync(() => deliver(item)),
        ),
      );
      const viewer = yield* Effect.promise(() => following);
      const heard = yield* Deferred.make<void>();
      // A listener hears an action before it folds: the test reads the state a turn later.
      viewer.listen((action) => {
        if (action.type === 'agent' && action.event.type === 'message')
          queueMicrotask(() => Deferred.doneUnsafe(heard, Effect.void));
      });

      // The order the owner's window logs them in (`storeDispatch`), then the agent's reply from Core's adapter.
      yield* store.append({
        type: COMMAND_TYPE,
        threadId: null,
        payload: create,
      });
      const threadId = 'new-1';
      yield* store.append({
        type: COMMAND_TYPE,
        threadId,
        payload: {
          type: 'agent-starting',
          threadId,
          provider: 'claude',
        } satisfies Action,
      });
      yield* agentEvent(store, {
        threadId,
        type: 'message',
        text: 'On it',
        isDelta: false,
      });
      yield* Deferred.await(heard);

      const thread = viewer.getState().threads.find((t) => t.id === threadId)!;
      viewer.stop();
      assert.equal(thread.live?.starting, undefined);
      assert.equal(thread.activity.at(-1)?.text, 'On it');

      // What `useMachines` shows: the thread file the `thread` stream sends once Core saves it (electron/remote/client.ts).
      yield* TestClock.adjust('1 second');
      const [file] = yield* store.thread(threadId, 0).pipe(
        Stream.filter((item) => item._tag === 'snapshot'),
        Stream.take(1),
        Stream.runCollect,
      );
      const mirrored = applyFrame('m', undefined, {
        type: 'thread',
        threadId,
        saved: file!.saved,
        sequence: file!.sequence,
      }).state.threads[0]!;
      assert.equal(mirrored.live?.starting, undefined);
      assert.equal(mirrored.activity.at(-1)?.text, 'On it');
    }).pipe(Effect.provide(layerStore())),
);
