import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { Effect, Fiber, Layer, Schema, Stream } from 'effect';
import { actionOf, COMMAND_TYPE, domainOf, type ReplicaItem } from '@mochi/domain';
import type { AgentEvent } from '../../../../src/host/types/agent.ts';
import { createReplica, type Replica, type ReplicaLog } from '../../../../src/store/replica.ts';
import { initialState } from '../../../../src/store/root.ts';
import type { Action } from '../../../../src/store/types.ts';
import { Projection } from './projection.ts';
import { ReplicaItem as ReplicaItemSchema } from './rpc.ts';
import { Store } from './store.ts';

type Core = { store: Store['Service']; projection: Projection['Service'] };

/** Runs `body` against Core's store and projection in `dir`, as a launch does. */
const withCore = <A>(dir: string, body: (core: Core) => Promise<A>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const core = { store: yield* Store, projection: yield* Projection };
        return yield* Effect.promise(() => body(core));
      }).pipe(Effect.provide(Projection.layer(undefined).pipe(Layer.provideMerge(Store.layer(join(dir, 'mochi.db'))), Layer.orDie))),
    ),
  );

/** A window's link to Core without the socket, items encoded as the socket encodes them. `drop` ends every stream it follows. */
const encode = Schema.encodeUnknownSync(Schema.toCodecJson(ReplicaItemSchema));

function linkTo({ store, projection }: Core) {
  const items: ReplicaItem[][] = [];
  const stops = new Set<() => void>();
  const log: ReplicaLog = {
    follow(afterSequence, onItem, onEnd) {
      const received: ReplicaItem[] = [];
      items.push(received);
      const fiber = Effect.runFork(
        Stream.runForEach(projection.replica(afterSequence), (item) =>
          Effect.sync(() => {
            const sent = JSON.parse(JSON.stringify(encode(item))) as ReplicaItem;
            received.push(sent);
            onItem(sent);
          }),
        ),
      );
      const stop = () => {
        stops.delete(stop);
        Effect.runFork(Fiber.interrupt(fiber));
      };
      stops.add(stop);
      return Object.assign(stop, { end: () => (stop(), onEnd(new Error('dropped'))) });
    },
    append: ({ commandId, threadId, action }) => Effect.runPromise(store.append({ type: COMMAND_TYPE, threadId, payload: action, commandId })),
  };
  const drop = () => {
    for (const stop of stops) (stop as typeof stop & { end: () => void }).end();
  };
  return { log, items, drop };
}

/** A window's store; it resolves on Core's first item, so a stream that can't send one fails here rather than hanging. */
const open = (log: ReplicaLog) =>
  Promise.race([
    createReplica(log, (saved) => initialState(saved, false), (run) => {
      const timer = setTimeout(run, 0);
      return () => clearTimeout(timer);
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Core sent the window nothing it could read')), 3000).unref()),
  ]);

const create: Action = { type: 'create', spaceId: 's', title: 'Stream a reply', provider: 'claude', project: null, isLive: true };
const word = (i: number): AgentEvent => ({ threadId: 'new-1', type: 'message', text: `w${i} `, isDelta: i > 0 });
const say = (store: Store['Service'], i: number) => Effect.runPromise(store.append({ type: `agent.${word(i).type}`, threadId: 'new-1', payload: word(i) }));
const reply = (replica: Replica) => replica.getState().threads.find((t) => t.id === 'new-1')?.activity.findLast((e) => e.kind === 'message' && e.who !== 'you')?.text;
/** As the socket carries it: an `undefined` field is no field. */
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const expected = (n: number) => Array.from({ length: n }, (_, i) => `w${i} `).join('');

/** Until Core and the window folded everything logged so far (Core's own saves aren't streamed). */
async function caughtUp(replica: Replica, { store, projection }: Core) {
  const [last] = await Effect.runPromise(store.eventsAfter(0)).then((events) => events.filter((e) => actionOf(e)).slice(-1).map((e) => e.sequence));
  for (let i = 0; i < 200; i++) {
    const { sequence } = await Effect.runPromise(projection.current);
    if (sequence >= last! && replica.sequence() >= last!) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('the window never caught up with Core');
}

test('a reload mid-stream picks the turn up from Core: every word once, in order', async () => {
  await withCore(mkdtempSync(join(tmpdir(), 'mochi-replica-')), async (core) => {
    const { log } = linkTo(core);
    const before = await open(log);
    before.dispatch(create);
    await before.sent();
    for (let i = 0; i < 20; i++) await say(core.store, i);
    await caughtUp(before, core);
    before.stop();

    const reloaded = await open(log);
    for (let i = 20; i < 50; i++) await say(core.store, i);
    await caughtUp(reloaded, core);
    assert.equal(reply(reloaded), expected(50));
    assert.deepEqual(asJson(domainOf(reloaded.getState()).threads), asJson((await Effect.runPromise(core.projection.current)).domain.threads));
  });
});

test('a dropped stream resumes from the last sequence it folded: a replay, not a snapshot, with no gap and no repeat', async () => {
  await withCore(mkdtempSync(join(tmpdir(), 'mochi-replica-')), async (core) => {
    const { log, items, drop } = linkTo(core);
    const replica = await open(log);
    replica.dispatch(create);
    await replica.sent();
    for (let i = 0; i < 10; i++) await say(core.store, i);
    await caughtUp(replica, core);
    drop();
    for (let i = 10; i < 30; i++) await say(core.store, i);
    // `createReplica` follows again a second after the drop.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await caughtUp(replica, core);
    assert.equal(reply(replica), expected(30));
    assert.equal(items.length, 2);
    assert.equal(items[1]![0]!._tag, 'event', 'the resume replays the gap');
    const resumed = items[1]!.flatMap((item) => (item._tag === 'event' ? [item.event.sequence] : []));
    assert.deepEqual(resumed, [...new Set(resumed)].sort((a, b) => a - b));
    replica.stop();
  });
});

test('two windows sending commands while the agent streams end up with the same threads as Core', async () => {
  await withCore(mkdtempSync(join(tmpdir(), 'mochi-replica-')), async (core) => {
    const { log } = linkTo(core);
    const [a, b] = await Promise.all([open(log), open(log)]);
    a.dispatch(create);
    await a.sent();
    await caughtUp(b, core);
    for (let i = 0; i < 10; i++) {
      void say(core.store, i);
      (i % 2 ? a : b).dispatch({ type: 'rename', threadId: 'new-1', title: `title ${i}` });
    }
    await Promise.all([a.sent(), b.sent()]);
    await caughtUp(a, core);
    await caughtUp(b, core);
    const { domain } = await Effect.runPromise(core.projection.current);
    assert.deepEqual(asJson(domainOf(a.getState()).threads), asJson(domain.threads));
    assert.deepEqual(asJson(domainOf(b.getState()).threads), asJson(domain.threads));
    assert.equal(reply(a), expected(10));
    a.stop();
    b.stop();
  });
});

test('the next launch loads the snapshot Core wrote: the turn it was in stopped, nothing folded twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-replica-'));
  await withCore(dir, async (core) => {
    await Effect.runPromise(core.store.append({ type: COMMAND_TYPE, payload: create, commandId: 'c1' }));
    for (let i = 0; i < 5; i++) await say(core.store, i);
    // Folded, not yet written: the finalizer writes it as Core stops.
    for (let i = 0; i < 50 && (await Effect.runPromise(core.projection.current)).domain.threads.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  });
  await withCore(dir, async ({ projection }) => {
    const { domain } = await Effect.runPromise(projection.current);
    const thread = domain.threads.find((t) => t.id === 'new-1')!;
    assert.equal(thread.activity.findLast((e) => e.kind === 'message' && e.who !== 'you')?.text, expected(5));
    assert.deepEqual([thread.live?.isWorking, thread.live?.isDetached], [false, true]);
  });
});
