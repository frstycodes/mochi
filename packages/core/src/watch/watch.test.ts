import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Effect, Fiber, Stream } from 'effect';
import type { WatchKey, WatchValue } from './keys.ts';
import { globsOf } from './roots.ts';
import { makeWatch, statusPaths, type WatchDeps } from './watch.ts';

const DIFF = { branch: 'feature', base: 'main', files: [] };

/** A fake git and main: counts each command and host call; `git status` prints the same thing every time. */
function fakeDeps(dir: string) {
  const calls = { status: 0, diff: 0, list: 0, ports: [] as string[][] };
  const deps: WatchDeps = {
    run: (_command, args) =>
      Effect.sync(() => {
        if (args[0] === 'rev-parse') return { stdout: `${dir}\n${path.join(dir, '.git')}\n` };
        calls.status++;
        return { stdout: '# branch.oid abc\0# branch.head feature\0' };
      }),
    host: (tag, args): Effect.Effect<unknown, unknown> =>
      Effect.suspend((): Effect.Effect<unknown, unknown> => {
        if (tag === 'git.diff') return Effect.sync(() => (calls.diff++, DIFF));
        if (tag === 'ports.list') return Effect.sync(() => (calls.ports.push(args[0] as string[]), (args[0] as string[]).map((cwd) => ({ ports: [{ port: 5173, pid: 1, command: cwd, startedAt: 0 }] }))));
        if (tag === 'fs.list') return (calls.list++, Effect.try(() => (realpathSync(dir), ['a.txt'])));
        return Effect.fail(`unexpected ${tag}`);
      }),
    children: Stream.never,
  };
  return { calls, deps };
}

const tempDir = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'mochi-watch-')));

/** Subscribes `key` in the background; `values` fills as they arrive. */
const subscribe = (watch: (key: WatchKey) => Stream.Stream<WatchValue>, key: WatchKey) =>
  Effect.gen(function* () {
    const values: WatchValue[] = [];
    const fiber = yield* Stream.runForEach(watch(key), (value) => Effect.sync(() => values.push(value))).pipe(Effect.forkScoped);
    return { values, fiber };
  });

const until = (condition: () => boolean, ms = 3000) => Effect.sleep(20).pipe(Effect.repeat({ until: condition, times: ms / 20 }));

test('four diff subscribers on one worktree share one git status and one diff', async () => {
  const dir = tempDir();
  const { calls, deps } = fakeDeps(dir);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { watch } = yield* makeWatch(deps);
        const key: WatchKey = { _tag: 'gitDiff', cwd: dir, scope: 'branch' };
        const subs = yield* Effect.all([subscribe(watch, key), subscribe(watch, key), subscribe(watch, key), subscribe(watch, key)]);
        yield* until(() => subs.every((s) => s.values.length > 0));
        assert.deepEqual(subs.map((s) => s.values), Array(4).fill([{ _tag: 'gitDiff', diff: DIFF }]));
        assert.deepEqual({ status: calls.status, diff: calls.diff }, { status: 1, diff: 1 });

        // Another scope on the same worktree reuses the fingerprint and reads only its own diff.
        const other = yield* subscribe(watch, { _tag: 'gitDiff', cwd: dir, scope: 'uncommitted' });
        yield* until(() => other.values.length > 0);
        assert.deepEqual({ status: calls.status, diff: calls.diff }, { status: 1, diff: 2 });
      }),
    ),
  ).finally(() => rmSync(dir, { recursive: true, force: true }));
});

test('no git read while nothing changes; a change re-reads status but not an unchanged diff; asleep reads nothing until it wakes', async () => {
  const dir = tempDir();
  const { calls, deps } = fakeDeps(dir);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { watch, setGate } = yield* makeWatch(deps);
        const sub = yield* subscribe(watch, { _tag: 'gitDiff', cwd: dir, scope: 'branch' });
        yield* until(() => sub.values.length > 0);
        yield* Effect.sleep(1000);
        assert.deepEqual({ status: calls.status, diff: calls.diff }, { status: 1, diff: 1 });

        writeFileSync(path.join(dir, 'a.txt'), 'one');
        yield* until(() => calls.status === 2);
        assert.equal(calls.status, 2, 'a write marks git stale');
        assert.equal(calls.diff, 1, 'the fingerprint did not move, so the diff is not re-read');

        yield* setGate({ isVisible: true, isAsleep: true, isOnBattery: false });
        writeFileSync(path.join(dir, 'b.txt'), 'two');
        yield* Effect.sleep(500);
        assert.equal(calls.status, 2, 'asleep: no read');
        yield* setGate({ isVisible: true, isAsleep: false, isOnBattery: false });
        yield* until(() => calls.status === 3);
        assert.equal(calls.status, 3, 'waking reads once');
      }),
    ),
  ).finally(() => rmSync(dir, { recursive: true, force: true }));
});

test('deleting a watched root while subscribed fails its reads as values and throws nothing', async () => {
  const dir = tempDir();
  const { deps } = fakeDeps(dir);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { watch } = yield* makeWatch(deps);
        const files = yield* subscribe(watch, { _tag: 'files', root: dir });
        const changes = yield* subscribe(watch, { _tag: 'changes', root: dir });
        const diff = yield* subscribe(watch, { _tag: 'gitDiff', cwd: dir, scope: 'branch' });
        yield* until(() => files.values.length > 0 && diff.values.length > 0);
        writeFileSync(path.join(dir, 'new.txt'), 'x');
        yield* until(() => files.values.length > 1);
        rmSync(dir, { recursive: true, force: true });
        yield* until(() => files.values.at(-1)?._tag === 'error');
        assert.equal(files.values.at(-1)?._tag, 'error');
        for (const { fiber } of [files, changes, diff]) assert.equal(fiber.pollUnsafe(), undefined, 'every subscription is still running');
        yield* Effect.forEach([files, changes, diff], ({ fiber }) => Fiber.interrupt(fiber));
      }),
    ),
  ).finally(() => rmSync(dir, { recursive: true, force: true }));
});

test('every subscribed cwd shares one ports scan, and scanning stops with the last subscriber', async () => {
  const { calls, deps } = fakeDeps('/unused');
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { watch } = yield* makeWatch(deps);
        const a = yield* subscribe(watch, { _tag: 'ports', cwd: '/a' });
        yield* until(() => a.values.length > 0);
        const b = yield* subscribe(watch, { _tag: 'ports', cwd: '/b' });
        yield* until(() => b.values.length > 0);
        assert.deepEqual(calls.ports.at(-1), ['/a', '/b'], 'a new cwd joins the shared scan');
        assert.deepEqual(b.values, [{ _tag: 'ports', listing: { ports: [{ port: 5173, pid: 1, command: '/b', startedAt: 0 }] } }]);
        assert.equal(a.values.length, 1, "/a's listing did not change, so its subscriber hears nothing new");

        yield* Effect.forEach([a, b], ({ fiber }) => Fiber.interrupt(fiber));
        const scans = calls.ports.length;
        yield* Effect.sleep(200);
        assert.equal(calls.ports.length, scans, 'no subscriber, no scan');
      }),
    ),
  );
});

test('statusPaths reads every porcelain v2 entry kind', () => {
  const output = ['# branch.oid abc', '1 .M N... 100644 100644 100644 h1 h2 src/a file.ts', '2 R. N... 100644 100644 100644 h1 h2 R100 new.ts', 'old.ts', 'u UU N... 1 2 3 4 h1 h2 h3 conflict.ts', '? untracked.ts', ''].join('\0');
  assert.deepEqual(statusPaths(output), ['src/a file.ts', 'new.ts', 'old.ts', 'conflict.ts', 'untracked.ts']);
});

test('globsOf turns plain .gitignore lines into parcel globs', () => {
  assert.deepEqual(globsOf('# build\n/dist/\n*.log\n!keep.log\n\n'), ['dist', 'dist/**', '**/*.log', '**/*.log/**']);
});
