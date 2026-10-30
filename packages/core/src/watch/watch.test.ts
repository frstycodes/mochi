import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Effect, Fiber, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { WatchKey, WatchValue } from './keys.ts';
import { globsOf } from './roots.ts';
import { makeWatch, statusPaths, type WatchDeps } from './watch.ts';

const DIFF = { branch: 'feature', base: 'main', files: [] };

/** A fake git and main: counts each command and host call; `git status` prints the same thing every time. */
const fakeDeps = (dir: string) =>
  Effect.gen(function* () {
    const calls = { status: 0, diff: 0, list: 0, ports: [] as string[][] };
    const statuses = yield* Queue.unbounded<number>();
    const deps: WatchDeps = {
      run: (_command, args) =>
        Effect.sync(() => {
          if (args[0] === 'rev-parse')
            return { stdout: `${dir}\n${path.join(dir, '.git')}\n` };
          Queue.offerUnsafe(statuses, ++calls.status);
          return { stdout: '# branch.oid abc\0# branch.head feature\0' };
        }),
      host: (tag, args): Effect.Effect<unknown, unknown> =>
        Effect.suspend((): Effect.Effect<unknown, unknown> => {
          if (tag === 'git.diff')
            return Effect.sync(() => (calls.diff++, DIFF));
          if (tag === 'ports.list')
            return Effect.sync(
              () => (
                calls.ports.push(args[0] as string[]),
                (args[0] as string[]).map((cwd) => ({
                  ports: [{ port: 5173, pid: 1, command: cwd, startedAt: 0 }],
                }))
              ),
            );
          if (tag === 'fs.list')
            return (
              calls.list++, Effect.try(() => (realpathSync(dir), ['a.txt']))
            );
          return Effect.fail(`unexpected ${tag}`);
        }),
      children: Stream.never,
    };
    /** Until the `count`th `git status` ran. */
    const statusRead = (count: number) =>
      Queue.take(statuses).pipe(
        Effect.repeat({ until: (n) => n >= count }),
        Effect.asVoid,
      );
    return { calls, deps, statusRead };
  });

const tempDir = () =>
  realpathSync(mkdtempSync(path.join(tmpdir(), 'mochi-watch-')));
const removed = (dir: string) =>
  Effect.ensuring(
    Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );

const WAIT_MS = 10_000;
const ATTEMPT_MS = 2_000;
const ATTEMPTS = 5;

/**
 * `effect`, failing with a message naming `what` if it hasn't finished in `ms` of real time, so a hang says which wait it was.
 * The timer is real even under `it.effect`, where TestClock never advances on its own.
 */
const within = <A, E, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
  ms = WAIT_MS,
) =>
  Effect.raceFirst(
    effect,
    Effect.callback<never>((resume) => {
      const timer = setTimeout(
        () =>
          resume(
            Effect.die(
              new Error(`Timed out after ${ms}ms waiting for ${what}`),
            ),
          ),
        ms,
      );
      return Effect.sync(() => clearTimeout(timer));
    }),
  );

/**
 * Makes a change on disk and waits for the watcher to report it, making it again if it doesn't: @parcel/watcher resolves
 * `subscribe` before Windows is surely delivering events, so a change made right after is sometimes never reported.
 */
const changedUntilSeen = <A, E, R>(
  what: string,
  change: (attempt: number) => void,
  seen: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      change(attempt);
      const result = yield* seen.pipe(Effect.timeoutOption(ATTEMPT_MS));
      if (result._tag === 'Some') return result.value;
    }
    return yield* Effect.die(
      new Error(
        `Timed out waiting for ${what}: ${ATTEMPTS} changes, none reported within ${ATTEMPT_MS}ms each`,
      ),
    );
  });

/** Subscribes `key` in the background; `values` fills as they arrive, and `next` waits for the next one. */
const subscribe = (
  watch: (key: WatchKey) => Stream.Stream<WatchValue>,
  key: WatchKey,
) =>
  Effect.gen(function* () {
    const values: WatchValue[] = [];
    const arrived = yield* Queue.unbounded<WatchValue>();
    const fiber = yield* Stream.runForEach(watch(key), (value) =>
      Effect.sync(
        () => (values.push(value), Queue.offerUnsafe(arrived, value)),
      ),
    ).pipe(Effect.forkScoped);
    const next = Queue.take(arrived);
    return {
      values,
      fiber,
      next,
      nextWhere: (isDone: (value: WatchValue) => boolean) =>
        next.pipe(Effect.repeat({ until: isDone })),
    };
  });

it.live(
  'four diff subscribers on one worktree share one git status and one diff',
  () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const { calls, deps } = yield* fakeDeps(dir);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { watch } = yield* makeWatch(deps);
          const key: WatchKey = { _tag: 'gitDiff', cwd: dir, scope: 'branch' };
          const subs = yield* Effect.all([
            subscribe(watch, key),
            subscribe(watch, key),
            subscribe(watch, key),
            subscribe(watch, key),
          ]);
          yield* within(
            'the first value of all four subscribers',
            Effect.forEach(subs, (s) => s.next),
          );
          assert.deepEqual(
            subs.map((s) => s.values),
            Array(4).fill([{ _tag: 'gitDiff', diff: DIFF }]),
          );
          assert.deepEqual(
            { status: calls.status, diff: calls.diff },
            { status: 1, diff: 1 },
          );

          // Another scope on the same worktree reuses the fingerprint and reads only its own diff.
          const other = yield* subscribe(watch, {
            _tag: 'gitDiff',
            cwd: dir,
            scope: 'uncommitted',
          });
          yield* within('the first value of subscriber other', other.next);
          assert.deepEqual(
            { status: calls.status, diff: calls.diff },
            { status: 1, diff: 2 },
          );
        }),
      ).pipe(removed(dir));
    }),
);

it.effect(
  'an hour with nothing changed reads git once, when the subscriber arrives',
  () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const { calls, deps } = yield* fakeDeps(dir);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { watch } = yield* makeWatch(deps);
          const sub = yield* subscribe(watch, {
            _tag: 'gitDiff',
            cwd: dir,
            scope: 'branch',
          });
          yield* within('the first value', sub.next);
          yield* TestClock.adjust('1 hour');
          assert.deepEqual(
            { status: calls.status, diff: calls.diff },
            { status: 1, diff: 1 },
          );
          assert.equal(sub.values.length, 1);
        }),
      ).pipe(removed(dir));
    }),
);

it.live(
  'no git read while nothing changes; a change re-reads status but not an unchanged diff; asleep reads nothing until it wakes',
  () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const { calls, deps, statusRead } = yield* fakeDeps(dir);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { watch, setGate } = yield* makeWatch(deps);
          const sub = yield* subscribe(watch, {
            _tag: 'gitDiff',
            cwd: dir,
            scope: 'branch',
          });
          const changes = yield* subscribe(watch, {
            _tag: 'changes',
            root: dir,
          });
          yield* within('the first diff', sub.next);
          assert.deepEqual(
            { status: calls.status, diff: calls.diff },
            { status: 1, diff: 1 },
          );

          yield* changedUntilSeen(
            'a write to mark git stale (a second git status)',
            (n) => writeFileSync(path.join(dir, 'a.txt'), `one-${n}`),
            statusRead(2),
          );
          assert.ok(calls.status >= 2, 'a write marks git stale');
          assert.equal(
            calls.diff,
            1,
            'the fingerprint did not move, so the diff is not re-read',
          );

          yield* setGate({
            isVisible: true,
            isAsleep: true,
            isOnBattery: false,
          });
          const readsBeforeSleep = calls.status;
          yield* changedUntilSeen(
            "b.txt in the 'changes' stream",
            (n) => writeFileSync(path.join(dir, 'b.txt'), `two-${n}`),
            changes.nextWhere(
              (value) =>
                value._tag === 'changes' &&
                value.paths.some((p) => p.endsWith('b.txt')),
            ),
          );
          assert.equal(calls.status, readsBeforeSleep, 'asleep: no read');
          yield* setGate({
            isVisible: true,
            isAsleep: false,
            isOnBattery: false,
          });
          yield* within(
            'a git status after waking',
            statusRead(readsBeforeSleep + 1),
          );
          assert.equal(calls.status, readsBeforeSleep + 1, 'waking reads once');
        }),
      ).pipe(removed(dir));
    }),
);

it.live(
  'a failed diff read is retried on the next stale mark, though the worktree did not change',
  () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const { calls, deps } = yield* fakeDeps(dir);
      let isServed = false;
      const host: WatchDeps['host'] = (tag, args) =>
        Effect.suspend(() =>
          tag === 'git.diff' && !isServed
            ? Effect.fail('No connected client offers host')
            : deps.host(tag, args),
        );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { watch, markStale } = yield* makeWatch({ ...deps, host });
          const sub = yield* subscribe(watch, {
            _tag: 'gitDiff',
            cwd: dir,
            scope: 'branch',
          });
          yield* within('the first value', sub.next);

          isServed = true;
          yield* markStale(['git']);
          yield* within(
            'the diff re-read after markStale',
            sub.nextWhere((value) => value._tag === 'gitDiff'),
          );
          assert.deepEqual(sub.values, [
            { _tag: 'error', message: 'No connected client offers host' },
            { _tag: 'gitDiff', diff: DIFF },
          ]);
          assert.equal(calls.diff, 1);
        }),
      ).pipe(removed(dir));
    }),
);

// TODO(windows): deleting the watched root itself sends no @parcel/watcher event on Windows, so nothing re-reads it and the
// files key stays stale instead of turning into an error value. Needs a watch on the root's parent, or a re-read on EPERM.
it.live.skipIf(process.platform === 'win32')(
  'deleting a watched root while subscribed fails its reads as values and throws nothing',
  () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const { deps } = yield* fakeDeps(dir);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { watch } = yield* makeWatch(deps);
          const files = yield* subscribe(watch, { _tag: 'files', root: dir });
          const changes = yield* subscribe(watch, {
            _tag: 'changes',
            root: dir,
          });
          const diff = yield* subscribe(watch, {
            _tag: 'gitDiff',
            cwd: dir,
            scope: 'branch',
          });
          yield* within('the first value of subscriber files', files.next);
          yield* within('the first value of subscriber diff', diff.next);
          writeFileSync(path.join(dir, 'new.txt'), 'x');
          yield* within('the files list after new.txt', files.next);
          rmSync(dir, { recursive: true, force: true });
          yield* within(
            'the files key to fail after its root was deleted',
            files.nextWhere((value) => value._tag === 'error'),
          );
          assert.equal(files.values.at(-1)?._tag, 'error');
          for (const { fiber } of [files, changes, diff])
            assert.equal(
              fiber.pollUnsafe(),
              undefined,
              'every subscription is still running',
            );
          yield* Effect.forEach([files, changes, diff], ({ fiber }) =>
            Fiber.interrupt(fiber),
          );
        }),
      ).pipe(removed(dir));
    }),
);

it.effect(
  'every subscribed cwd shares one ports scan, and scanning stops with the last subscriber',
  () =>
    Effect.gen(function* () {
      const { calls, deps } = yield* fakeDeps('/unused');
      const { watch } = yield* makeWatch(deps);
      const a = yield* subscribe(watch, { _tag: 'ports', cwd: '/a' });
      yield* within('the first value of subscriber a', a.next);
      const b = yield* subscribe(watch, { _tag: 'ports', cwd: '/b' });
      yield* within('the first value of subscriber b', b.next);
      assert.deepEqual(
        calls.ports.at(-1),
        ['/a', '/b'],
        'a new cwd joins the shared scan',
      );
      assert.deepEqual(b.values, [
        {
          _tag: 'ports',
          listing: {
            ports: [{ port: 5173, pid: 1, command: '/b', startedAt: 0 }],
          },
        },
      ]);
      assert.equal(
        a.values.length,
        1,
        "/a's listing did not change, so its subscriber hears nothing new",
      );

      yield* Effect.forEach([a, b], ({ fiber }) => Fiber.interrupt(fiber));
      const scans = calls.ports.length;
      yield* TestClock.adjust('1 minute');
      assert.equal(calls.ports.length, scans, 'no subscriber, no scan');
    }),
);

it('statusPaths reads every porcelain v2 entry kind', () => {
  const output = [
    '# branch.oid abc',
    '1 .M N... 100644 100644 100644 h1 h2 src/a file.ts',
    '2 R. N... 100644 100644 100644 h1 h2 R100 new.ts',
    'old.ts',
    'u UU N... 1 2 3 4 h1 h2 h3 conflict.ts',
    '? untracked.ts',
    '',
  ].join('\0');
  assert.deepEqual(statusPaths(output), [
    'src/a file.ts',
    'new.ts',
    'old.ts',
    'conflict.ts',
    'untracked.ts',
  ]);
});

it('globsOf turns plain .gitignore lines into parcel globs', () => {
  assert.deepEqual(globsOf('# build\n/dist/\n*.log\n!keep.log\n\n'), [
    'dist',
    'dist/**',
    '**/*.log',
    '**/*.log/**',
  ]);
});
