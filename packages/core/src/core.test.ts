import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
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
    const { port, connected } = yield* processLine(2);
    // Each process holds a socket to the test: it closes when the OS tears that process down, whoever killed it.
    const hold = `require('node:net').connect(${port}, '127.0.0.1').on('error', () => {}); setTimeout(() => {}, 100000);`;
    const script = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(hold)}], { stdio: 'ignore' }); ${hold}`;
    const { run } = yield* Run;
    const fiber = yield* run(process.execPath, ['-e', script]).pipe(Effect.forkChild);
    const closed = yield* connected;
    yield* Fiber.interrupt(fiber).pipe(Effect.timeoutOrElse({ duration: INTERRUPT_BUDGET_MS, orElse: () => Effect.die(`interrupt took over ${INTERRUPT_BUDGET_MS}ms`) }));
    yield* closed.pipe(
      Effect.timeoutOrElse({ duration: '5 seconds', orElse: () => Effect.die('a process outlived the interrupt') }),
    );
  }).pipe(Effect.provide(layerRun)),
);

/** A local server: `connected` once `count` processes have connected, then `closed` once each of their sockets has. */
const processLine = (count: number) =>
  Effect.acquireRelease(
    Effect.callback<{ server: Server; port: number; connected: Effect.Effect<Effect.Effect<void>> }>((resume) => {
      // Listened for on connect: a socket can close while the test is still interrupting.
      const closes: Promise<unknown>[] = [];
      let all: () => void = () => {};
      const connected = Effect.promise(() => new Promise<void>((resolve) => (all = resolve))).pipe(Effect.as(Effect.promise(() => Promise.all(closes))));
      const server = createServer((socket) => {
        socket.on('error', () => {});
        if (closes.push(new Promise((resolve) => socket.once('close', resolve))) === count) all();
      });
      server.listen(0, '127.0.0.1', () => resume(Effect.succeed({ server, port: (server.address() as AddressInfo).port, connected })));
    }),
    ({ server }) => Effect.sync(() => server.close()),
  );

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
