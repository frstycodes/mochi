import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import type { SqlClient } from 'effect/sql';
import { emptyShell, emptyThread, projectShell, projectThread } from '@mochi/domain';
import { importJson } from './importJson.ts';
import { Store } from './store.ts';

const fixture = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-store-'));
  cpSync(join(import.meta.dirname, 'fixtures', name), dir, { recursive: true });
  return dir;
};

/** Runs `body` against a store in `dir` (a file database, so the reader and checkpoint workers run too). */
const withStore = <A>(dir: string, body: Effect.Effect<A, unknown, Store | SqlClient.SqlClient>) =>
  Effect.scoped(Effect.provide(body, Store.layer(join(dir, 'mochi.db')).pipe(Layer.orDie))) as Effect.Effect<A>;

const run = <A>(body: Effect.Effect<A, unknown, Store>) => withStore(mkdtempSync(join(tmpdir(), 'mochi-store-')), body);

it.effect('the import takes threads, settings, projects, limits and window bounds; an unreadable file is kept aside, not overwritten', () =>
  Effect.gen(function* () {
    const dir = fixture('split');
    const schedules = readFileSync(join(dir, 'schedules.json'), 'utf8');
    const result = yield* withStore(
      dir,
      Effect.gen(function* () {
        const corrupt = yield* importJson(dir);
        const store = yield* Store;
        return {
          corrupt,
          threads: yield* store.loadThreads,
          settings: yield* store.getDoc('settings', 'agent'),
          schedules: yield* store.getDoc('schedule', 'schedules'),
          limits: yield* store.listDocs('limits'),
          bounds: yield* store.getDoc('window_bounds', 'main'),
          shell: yield* store.shell.pipe(Stream.take(1), Stream.runCollect),
          again: yield* importJson(dir),
        };
      }),
    );
    assert.deepEqual(result.settings, { model: 'opus', accounts: [{ id: 'a1' }], apiKeys: { claude: 'ZW5j' } });
    assert.equal(result.schedules, undefined);
    assert.deepEqual(result.limits, [{ key: 'a1', value: { accountId: 'a1', provider: 'claude', windows: [] } }]);
    assert.deepEqual(result.bounds, { x: 10, y: 20, width: 800, height: 600 });
    // t2's file is cut off: that thread is left out, the others load.
    assert.equal(result.threads!.threads.length, 1);
    assert.equal(JSON.parse(result.threads!.threads[0]!).thread.title, 'Fix login');
    assert.deepEqual(
      result.corrupt.map((c) => c.file),
      [join(dir, 'schedules.json'), join(dir, 'threads', 't2.json')],
    );
    for (const { kept } of result.corrupt) assert.ok(existsSync(kept));
    assert.equal(readFileSync(result.corrupt[0]!.kept, 'utf8'), schedules);
    assert.ok(!existsSync(join(dir, 'schedules.json')));
    assert.deepEqual(result.again, [], 'a second launch imports nothing');
    const [snapshot] = [...result.shell];
    assert.ok(snapshot?._tag === 'snapshot');
    assert.deepEqual(snapshot.shell.threads, [{ id: 't1', title: 'Fix login', status: 'idle', project: 'p1' }]);
    assert.deepEqual(snapshot.shell.projects, [{ id: 'p1', name: 'Mochi', path: '/src/mochi', space: 'default' }]);
  }),
);

it.effect('a legacy threads.json imports whole, as the index the projection joins', () =>
  Effect.gen(function* () {
    const dir = fixture('legacy');
    const threads = yield* withStore(dir, Effect.andThen(importJson(dir), Effect.flatMap(Effect.service(Store), (store) => store.loadThreads)));
    assert.deepEqual(threads, { index: readFileSync(join(dir, 'threads.json'), 'utf8'), threads: [], sequence: 0 });
    assert.ok(readdirSync(dir).includes('threads.json'), 'the original stays');
  }),
);

it.effect('a command appended twice is applied once', () =>
  Effect.gen(function* () {
    const [first, second, events] = yield* run(
      Effect.gen(function* () {
        const store = yield* Store;
        const first = yield* store.append({ type: 'thread.renamed', threadId: 't', payload: { title: 'x' }, commandId: 'c1' });
        const second = yield* store.append({ type: 'thread.renamed', threadId: 't', payload: { title: 'x' }, commandId: 'c1' });
        const events = yield* store.thread('t', 0).pipe(Stream.take(2), Stream.runCollect);
        return [first, second, [...events]] as const;
      }),
    );
    assert.deepEqual(first, { sequence: 1, isDuplicate: false });
    assert.deepEqual(second, { sequence: 1, isDuplicate: true });
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { _tag: 'snapshot', sequence: 0, saved: null });
  }),
);

const index = (ids: string[]) => JSON.stringify({ version: 1, threadIds: ids });
const saved = (id: string, title: string) => JSON.stringify({ thread: { id, title } });

/** Collects `count` items of `stream` in the background, once its first item shows it read what it starts from. */
const following = <A>(stream: Stream.Stream<A, unknown>, count: number) =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* stream.pipe(Stream.tap(() => Deferred.succeed(started, undefined)), Stream.take(count), Stream.runCollect, Effect.forkChild);
    yield* Deferred.await(started);
    return fiber;
  });

it.effect('thread replays a small gap, sends a snapshot past one, then live events and new saves', () =>
  Effect.gen(function* () {
    const items = yield* run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.saveThreads(index(['t']), { t: saved('t', 'one') });
        for (let i = 0; i < 3; i++) yield* store.append({ type: 'agent.text', threadId: 't', payload: { i } });
        const replay = yield* store.thread('t', 2).pipe(Stream.take(2), Stream.runCollect);
        for (let i = 0; i < 130; i++) yield* store.append({ type: 'agent.text', threadId: 't', payload: { i } });
        yield* store.append({ type: 'agent.text', threadId: 'other', payload: {} });
        const live = yield* following(store.thread('t', 2), 136);
        yield* store.saveThreads(index(['t']), { t: saved('t', 'two') });
        yield* store.append({ type: 'agent.text', threadId: 't', payload: { last: true } });
        return { replay: [...replay], live: [...(yield* Fiber.join(live))] };
      }),
    );
    assert.deepEqual(items.replay.map((i) => (i._tag === 'event' ? i.event.sequence : i.sequence)), [3, 4]);
    const view = items.live.reduce(projectThread, emptyThread);
    assert.equal(items.live[0]!._tag, 'snapshot', 'past 128 events the stream starts from the snapshot');
    assert.deepEqual(view.saved, { thread: { id: 't', title: 'two' } });
    assert.deepEqual(view.events.map((e) => e.payload), [{ last: true }]);
  }),
);

it.effect('the shell follows saves, deletes and the project registry', () =>
  Effect.gen(function* () {
    const items = yield* run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.saveThreads(index(['a', 'b']), { a: saved('a', 'A'), b: saved('b', 'B') });
        const shell = yield* following(store.shell, 3);
        yield* store.saveThreads(index(['b']), {});
        yield* store.setDoc('projects', 'registry', { spaces: { s: { projects: [{ id: 'p', name: 'P', path: '/p' }] } } });
        return [...(yield* Fiber.join(shell))];
      }),
    );
    const shell = items.reduce(projectShell, emptyShell);
    assert.deepEqual(shell.threads, [{ id: 'b', title: 'B', status: null, project: null }]);
    assert.deepEqual(shell.projects, [{ id: 'p', name: 'P', path: '/p', space: 's' }]);
  }),
);

it.effect('the outbox hands each due effect out once and again after a restart', () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-store-'));
    const claimed = yield* withStore(
      dir,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.enqueue({ commandId: 'c', type: 'notify', payload: { n: 1 } });
        yield* store.enqueue({ commandId: 'c', type: 'later', availableAt: '2999-01-01T00:00:00.000Z' });
        const first = yield* store.claim(10);
        return { first, second: yield* store.claim(10) };
      }),
    );
    assert.deepEqual(claimed.first.map((e) => [e.type, e.attempt]), [['notify', 1]]);
    assert.deepEqual(claimed.second, []);
    const afterRestart = yield* withStore(
      dir,
      Effect.gen(function* () {
        const store = yield* Store;
        const [effect] = yield* store.claim(10);
        yield* store.complete(effect!.id);
        return { effect, rest: yield* store.claim(10) };
      }),
    );
    assert.deepEqual([afterRestart.effect!.type, afterRestart.effect!.attempt], ['notify', 2]);
    assert.deepEqual(afterRestart.rest, []);
  }),
);
