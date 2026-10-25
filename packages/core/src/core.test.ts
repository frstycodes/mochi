import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from '@effect/vitest';
import { Effect, Exit, Fiber, Layer } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { TestClock } from 'effect/testing';
import { Cache } from './cache.ts';
import { Run, RunError } from './run.ts';

const layerRun = Run.layer.pipe(Layer.provide(NodeServices.layer));

// Windows has to start taskkill.exe before the tree dies (CI measured 115ms); elsewhere it's one kill(-pid).
const INTERRUPT_BUDGET_MS = process.platform === 'win32' ? 500 : 100;

it.live('interrupting run kills a 100s child and its grandchild within budget', () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-run-'));
    yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true })));
    const pidFile = path.join(dir, 'pids');
    // Written aside and renamed, so the file appears with its content.
    const script = `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], { stdio: 'ignore' });
fs.writeFileSync(process.argv[1] + '.tmp', process.pid + ' ' + grandchild.pid);
fs.renameSync(process.argv[1] + '.tmp', process.argv[1]);
setTimeout(() => {}, 100000);`;
    const { run } = yield* Run;
    const appeared = fileAppears(dir, pidFile);
    const fiber = yield* run(process.execPath, ['-e', script, pidFile]).pipe(Effect.forkChild);
    yield* appeared;
    const pids = readFileSync(pidFile, 'utf8').split(' ').map(Number);
    yield* Fiber.interrupt(fiber).pipe(Effect.timeoutOrElse({ duration: INTERRUPT_BUDGET_MS, orElse: () => Effect.die(`interrupt took over ${INTERRUPT_BUDGET_MS}ms`) }));
    // A process that isn't ours has no exit event to await.
    yield* Effect.promise(() => expect.poll(() => pids.filter(isAlive)).toEqual([]));
  }).pipe(Effect.provide(layerRun)),
);

/** Resolves once `file` exists in `dir`, watching from before the check so a write in between isn't missed. */
const fileAppears = (dir: string, file: string) =>
  Effect.callback<void>((resume) => {
    const watcher = watch(dir, () => existsSync(file) && resume(Effect.void));
    if (existsSync(file)) resume(Effect.void);
    return Effect.sync(() => watcher.close());
  }).pipe(Effect.scoped);

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH: no such process.
  }
}

it.live('run fails outside okCodes and caps a queue', () =>
  Effect.gen(function* () {
    const { run } = yield* Run;
    const exit = yield* run('sh', ['-c', 'echo nope >&2; exit 3']).pipe(Effect.exit);
    assert.ok(Exit.isFailure(exit) && exit.cause.reasons.some((reason) => reason._tag === 'Fail' && reason.error instanceof RunError && reason.error.code === 3));
    assert.equal((yield* run('sh', ['-c', 'exit 3'], { okCodes: [3] })).code, 3);

    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-run-'));
    yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true })));
    const log = path.join(dir, 'log');
    const step = ['-c', `echo start >> "${log}"; sleep 0.1; echo end >> "${log}"`];
    yield* Effect.all([run('sh', step, { queue: 'lsof' }), run('sh', step, { queue: 'lsof' })], { concurrency: 'unbounded' });
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['start', 'end', 'start', 'end'], 'lsof queue ran two at once');
  }).pipe(Effect.provide(layerRun)),
);

it.effect('cache keeps a success for its TTL and drops failures', () =>
  Effect.gen(function* () {
    let lookups = 0;
    const lookup = Effect.sync(() => ++lookups);
    const cache = yield* Cache;
    assert.equal(yield* cache.get('a', lookup, '1 minute'), 1);
    assert.equal(yield* cache.get('a', lookup, '1 minute'), 1);
    yield* TestClock.adjust('2 minutes');
    assert.equal(yield* cache.get('a', lookup, '1 minute'), 2);

    yield* cache.get('b', Effect.fail('down'), '1 minute').pipe(Effect.exit);
    assert.equal(yield* cache.get('b', Effect.succeed('up'), '1 minute'), 'up');
  }).pipe(Effect.provide(Cache.layer)),
);
