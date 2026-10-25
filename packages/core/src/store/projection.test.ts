import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import {
  Effect,
  Fiber,
  FiberSet,
  Layer,
  Schema,
  type Scope,
  Stream,
} from 'effect';
import {
  actionOf,
  COMMAND_TYPE,
  domainOf,
  type ReplicaItem,
} from '@mochi/domain';
import type { AgentEvent } from '../../../../src/host/types/agent.ts';
import {
  createReplica,
  type Replica,
  type ReplicaLog,
} from '../../../../src/store/replica.ts';
import { initialState } from '../../../../src/store/root.ts';
import type { Action } from '../../../../src/store/types.ts';
import { Projection } from './projection.ts';
import { ReplicaItem as ReplicaItemSchema } from './rpc.ts';
import { Store } from './store.ts';

type Core = { store: Store['Service']; projection: Projection['Service'] };

/** Runs `body` against Core's store and projection in `dir`, as a launch does. */
const withCore = <A, E>(
  dir: string,
  body: (core: Core) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const core = { store: yield* Store, projection: yield* Projection };
    return yield* Effect.scoped(body(core));
  }).pipe(
    Effect.provide(
      Projection.layer(undefined).pipe(
        Layer.provideMerge(Store.layer(join(dir, 'mochi.db'))),
        Layer.orDie,
      ),
    ),
  );

/** A window's link to Core without the socket, items encoded as the socket encodes them. `drop` ends every stream it follows. */
const encode = Schema.encodeUnknownSync(Schema.toCodecJson(ReplicaItemSchema));

const linkTo = ({ store, projection }: Core) =>
  Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntime();
    const runPromise = yield* FiberSet.makeRuntimePromise();
    const items: ReplicaItem[][] = [];
    const stops = new Set<() => void>();
    const checks = new Set<() => void>();
    const log: ReplicaLog = {
      follow(afterSequence, onItem, onEnd) {
        const received: ReplicaItem[] = [];
        items.push(received);
        const fiber = run(
          Stream.runForEach(projection.replica(afterSequence), (item) =>
            Effect.sync(() => {
              const sent = JSON.parse(
                JSON.stringify(encode(item)),
              ) as ReplicaItem;
              received.push(sent);
              onItem(sent);
              for (const check of checks) check();
            }),
          ),
        );
        const stop = () => {
          stops.delete(stop);
          run(Fiber.interrupt(fiber));
        };
        stops.add(stop);
        return Object.assign(stop, {
          end: () => (stop(), onEnd(new Error('dropped'))),
        });
      },
      append: ({ commandId, threadId, action }) =>
        runPromise(
          store.append({
            type: COMMAND_TYPE,
            threadId,
            payload: action,
            commandId,
          }),
        ),
    };
    const drop = () => {
      for (const stop of stops)
        (stop as typeof stop & { end: () => void }).end();
    };
    /** Resumes once `isDone` holds, checked again after each item a window folds. */
    const until = (isDone: () => boolean) =>
      Effect.callback<void>((resume) => {
        const check = () => {
          if (!isDone()) return;
          checks.delete(check);
          resume(Effect.void);
        };
        checks.add(check);
        check();
        return Effect.sync(() => void checks.delete(check));
      });
    /** Until Core and the window folded everything logged so far (Core's own saves aren't streamed). */
    const caughtUp = (replica: Replica) =>
      Effect.gen(function* () {
        const [last] = (yield* store.eventsAfter(0))
          .filter((e) => actionOf(e))
          .slice(-1)
          .map((e) => e.sequence);
        yield* until(() => replica.sequence() >= last!);
        assert.ok(
          (yield* projection.current).sequence >= last!,
          'Core folds an event before any window sees it',
        );
      });
    return { log, items, drop, caughtUp };
  });

/** A window's store; it resolves on Core's first item. */
const open = (log: ReplicaLog) =>
  Effect.promise(() =>
    createReplica(
      log,
      (saved) => initialState(saved, false),
      (run) => {
        const timer = setTimeout(run, 0);
        return () => clearTimeout(timer);
      },
    ),
  );

const create: Action = {
  type: 'create',
  spaceId: 's',
  title: 'Stream a reply',
  provider: 'claude',
  project: null,
  isLive: true,
};
const word = (i: number): AgentEvent => ({
  threadId: 'new-1',
  type: 'message',
  text: `w${i} `,
  isDelta: i > 0,
});
const say = (store: Store['Service'], i: number) =>
  store.append({
    type: `agent.${word(i).type}`,
    threadId: 'new-1',
    payload: word(i),
  });
const sayAll = (store: Store['Service'], from: number, to: number) =>
  Effect.gen(function* () {
    for (let i = from; i < to; i++) yield* say(store, i);
  });
const reply = (replica: Replica) =>
  replica
    .getState()
    .threads.find((t) => t.id === 'new-1')
    ?.activity.findLast((e) => e.kind === 'message' && e.who !== 'you')?.text;
/** As the socket carries it: an `undefined` field is no field. */
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const expected = (n: number) =>
  Array.from({ length: n }, (_, i) => `w${i} `).join('');

it.effect(
  'a reload mid-stream picks the turn up from Core: every word once, in order',
  () =>
    withCore(mkdtempSync(join(tmpdir(), 'mochi-replica-')), (core) =>
      Effect.gen(function* () {
        const { log, caughtUp } = yield* linkTo(core);
        const before = yield* open(log);
        before.dispatch(create);
        yield* Effect.promise(() => before.sent());
        yield* sayAll(core.store, 0, 20);
        yield* caughtUp(before);
        before.stop();

        const reloaded = yield* open(log);
        yield* sayAll(core.store, 20, 50);
        yield* caughtUp(reloaded);
        assert.equal(reply(reloaded), expected(50));
        assert.deepEqual(
          asJson(domainOf(reloaded.getState()).threads),
          asJson((yield* core.projection.current).domain.threads),
        );
      }),
    ),
);

it.effect(
  'a dropped stream resumes from the last sequence it folded: a replay, not a snapshot, with no gap and no repeat',
  () =>
    withCore(mkdtempSync(join(tmpdir(), 'mochi-replica-')), (core) =>
      Effect.gen(function* () {
        const { log, items, drop, caughtUp } = yield* linkTo(core);
        const replica = yield* open(log);
        replica.dispatch(create);
        yield* Effect.promise(() => replica.sent());
        yield* sayAll(core.store, 0, 10);
        yield* caughtUp(replica);
        drop();
        yield* sayAll(core.store, 10, 30);
        // `createReplica` follows again a second after the drop, on a real timer; catching up waits for that resume.
        yield* caughtUp(replica);
        assert.equal(reply(replica), expected(30));
        assert.equal(items.length, 2);
        assert.equal(items[1]![0]!._tag, 'event', 'the resume replays the gap');
        const resumed = items[1]!.flatMap((item) =>
          item._tag === 'event' ? [item.event.sequence] : [],
        );
        assert.deepEqual(
          resumed,
          [...new Set(resumed)].sort((a, b) => a - b),
        );
        replica.stop();
      }),
    ),
);

it.effect(
  'two windows sending commands while the agent streams end up with the same threads as Core',
  () =>
    withCore(mkdtempSync(join(tmpdir(), 'mochi-replica-')), (core) =>
      Effect.gen(function* () {
        const { log, caughtUp } = yield* linkTo(core);
        const [a, b] = yield* Effect.all([open(log), open(log)], {
          concurrency: 'unbounded',
        });
        a.dispatch(create);
        yield* Effect.promise(() => a.sent());
        yield* caughtUp(b);
        const words: Fiber.Fiber<unknown, unknown>[] = [];
        for (let i = 0; i < 10; i++) {
          words.push(
            yield* Effect.forkChild(say(core.store, i), {
              startImmediately: true,
            }),
          );
          (i % 2 ? a : b).dispatch({
            type: 'rename',
            threadId: 'new-1',
            title: `title ${i}`,
          });
        }
        yield* Effect.promise(() => Promise.all([a.sent(), b.sent()]));
        yield* Fiber.joinAll(words);
        yield* caughtUp(a);
        yield* caughtUp(b);
        const { domain } = yield* core.projection.current;
        assert.deepEqual(
          asJson(domainOf(a.getState()).threads),
          asJson(domain.threads),
        );
        assert.deepEqual(
          asJson(domainOf(b.getState()).threads),
          asJson(domain.threads),
        );
        assert.equal(reply(a), expected(10));
        a.stop();
        b.stop();
      }),
    ),
);

it.effect(
  'the next launch loads the snapshot Core wrote: the turn it was in stopped, nothing folded twice',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(join(tmpdir(), 'mochi-replica-'));
      yield* withCore(dir, (core) =>
        Effect.gen(function* () {
          // The create and five words; started at once, so it is subscribed before the first of them folds.
          const folded = yield* core.projection.folded.pipe(
            Stream.take(6),
            Stream.runDrain,
            Effect.forkChild({ startImmediately: true }),
          );
          yield* core.store.append({
            type: COMMAND_TYPE,
            payload: create,
            commandId: 'c1',
          });
          yield* sayAll(core.store, 0, 5);
          // Folded, not yet written: the finalizer writes it as Core stops.
          yield* Fiber.join(folded);
        }),
      );
      yield* withCore(dir, ({ projection }) =>
        Effect.gen(function* () {
          const { domain } = yield* projection.current;
          const thread = domain.threads.find((t) => t.id === 'new-1')!;
          assert.equal(
            thread.activity.findLast(
              (e) => e.kind === 'message' && e.who !== 'you',
            )?.text,
            expected(5),
          );
          assert.deepEqual(
            [thread.live?.isWorking, thread.live?.isDetached],
            [false, true],
          );
        }),
      );
    }),
);
