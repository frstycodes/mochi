import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { Effect, Fiber, Layer, Stream } from 'effect';
import type { Action } from '../../../../apps/desktop/src/store/types.ts';
import { AgentCaller, Commands } from '../store/commands.ts';
import { Projection } from '../store/projection.ts';
import { Store } from '../store/store.ts';
import { coreToolRunner, hearDecisions } from './coreTools.ts';

const create: Action = {
  type: 'create',
  spaceId: 's',
  title: 'Ship it',
  provider: 'claude',
  project: null,
  isLive: true,
};

const layer = () =>
  Commands.layer.pipe(
    Layer.provide(
      Layer.succeed(AgentCaller, {
        call: () => Effect.void,
        resolve: () => Effect.void,
      }),
    ),
    Layer.provideMerge(Projection.layer(undefined)),
    Layer.provideMerge(
      Store.layer(
        join(mkdtempSync(join(tmpdir(), 'mochi-tools-')), 'mochi.db'),
      ),
    ),
    Layer.orDie,
  );

/** Core's thread titled `title`, once its projection folds it. */
const titled = (title: string) =>
  Effect.gen(function* () {
    const projection = yield* Projection;
    const now = () =>
      Effect.map(
        projection.current,
        ({ domain }) => domain.threads.find((t) => t.id === 'new-1')?.title,
      );
    if ((yield* now()) === title) return;
    yield* projection.folded.pipe(
      Stream.filter(({ after }) =>
        after.threads.some((t) => t.id === 'new-1' && t.title === title),
      ),
      Stream.take(1),
      Stream.runDrain,
    );
  });

/** Your agent settings as a window sends them to Core. */
const setPrefs = (toolPolicies: Record<string, string>) =>
  Effect.gen(function* () {
    const { context } = (yield* (yield* Projection).current).domain;
    yield* (yield* Commands).apply({
      type: 'context',
      context: {
        ...context,
        prefs: { ...context.prefs, agentControl: 'everything', toolPolicies },
      },
    });
  });

/** The id of the next tool card Core folds into the queue. */
const nextCard = Effect.gen(function* () {
  const [folded] = yield* (yield* Projection).folded.pipe(
    Stream.filter(({ after }) => after.queue.some((q) => q.tool)),
    Stream.take(1),
    Stream.runCollect,
  );
  return folded!.after.queue.find((q) => q.tool)!.id;
});

it.effect(
  'with no window, an agent renames its thread in Core, under your agent settings',
  () =>
    Effect.gen(function* () {
      const commands = yield* Commands;
      const projection = yield* Projection;
      yield* setPrefs({});
      yield* commands.apply(create);
      const run = coreToolRunner(projection, commands);
      const result = yield* Effect.promise(() =>
        run('new-1', 'rename_thread', { threadId: 'new-1', title: 'Renamed' }),
      );
      assert.ok(!result.isError, result.text);
      yield* titled('Renamed');
    }).pipe(Effect.provide(layer())),
);

it.effect(
  'before a window sent your agent settings, Core refuses rather than run on the defaults',
  () =>
    Effect.gen(function* () {
      const commands = yield* Commands;
      const projection = yield* Projection;
      yield* commands.apply(create);
      const run = coreToolRunner(projection, commands);
      const result = yield* Effect.promise(() =>
        run('new-1', 'rename_thread', { threadId: 'new-1', title: 'Renamed' }),
      );
      assert.equal(result.isError, true);
      assert.match(result.text, /needs the Mochi app open/);
    }).pipe(Effect.provide(layer())),
);

it.effect(
  'a thread tool set to ask waits in Core, and goes on when any client logs your answer',
  () =>
    Effect.gen(function* () {
      const commands = yield* Commands;
      const projection = yield* Projection;
      yield* Effect.forkChild(hearDecisions(projection));
      yield* setPrefs({ rename_thread: 'ask' });
      yield* commands.apply(create);
      const run = coreToolRunner(projection, commands);
      // Subscribed before the call, so its card can't fold first.
      const card = yield* Effect.forkChild(nextCard, {
        startImmediately: true,
      });
      const pending = run('new-1', 'rename_thread', {
        threadId: 'new-1',
        title: 'Renamed',
      });
      const queueId = yield* Fiber.join(card);
      // Another client's answer: a window's MochiWidget or a device's resolve.
      yield* commands.apply({
        type: 'tool-decision',
        queueId,
        isApproved: true,
      });
      const result = yield* Effect.promise(() => pending);
      assert.ok(!result.isError, result.text);
      yield* titled('Renamed');
    }).pipe(Effect.provide(layer())),
);
