import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Cause, Context, Effect, Exit, Layer, Schedule, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import WebSocket from 'ws';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from './client.ts';
import { makeHostCaller, serveCapabilities } from './hostClient.ts';
import { mintDeviceToken } from './remote/token.ts';
import { Unauthorized } from './rpc.ts';
import { layerCore } from './server.ts';

const TOKEN = 'local-token';
const READ_TOKEN = 'read-token';
const ORIGIN = 'http://localhost:5173';

/** Core in-process on a free port; resolves to that port. */
const startCore = Effect.gen(function* () {
  const options = { port: 0, tokens: new Map<string, ReadonlyArray<Capabilities.AuthScope>>([[TOKEN, Capabilities.allScopes], [READ_TOKEN, ['read']]]), origins: [ORIGIN] };
  const context = yield* Layer.build(layerCore(options));
  return (Context.get(context, HttpServer.HttpServer).address as { port: number }).port;
});

/** `coreUrl`'s address, and its token as the subprotocols a client offers. */
const dial = (url: string): [string, string[]] => [url.split('#')[0]!, url.includes('#') ? Capabilities.subprotocolsFor(url.split('#')[1]!) : []];

/** A plain `ws` client speaking the JSON wire format, as a phone or a script would. */
function plainTicks(url: string, count: number, headers: { origin?: string } = {}) {
  return new Promise<number[]>((resolve, reject) => {
    const ws = new WebSocket(...dial(url), { headers });
    const ticks: number[] = [];
    ws.on('unexpected-response', (_request, response) => reject(new Error(`refused: ${response.statusCode}`)));
    ws.on('open', () => ws.send(JSON.stringify({ _tag: 'Request', id: '1', tag: 'ticks', payload: { intervalMs: 5 }, headers: [] })));
    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as { _tag: string; values?: number[] };
      if (message._tag !== 'Chunk') return;
      ticks.push(...message.values!);
      ws.send(JSON.stringify({ _tag: 'Ack', requestId: '1' }));
      if (ticks.length < count) return;
      ws.close();
      resolve(ticks.slice(0, count));
    });
  });
}

/** The HTTP status Core refused an upgrade with, or `open`. */
function upgradeStatus(url: string, headers: { origin?: string } = {}) {
  return new Promise<number | 'open'>((resolve) => {
    const ws = new WebSocket(...dial(url), { headers });
    ws.on('unexpected-response', (_request, response) => resolve(response.statusCode!));
    ws.on('open', () => (ws.close(), resolve('open')));
  });
}

test('a window client and a plain WebSocket client get the same ticks', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const port = yield* startCore;
        const window = yield* makeCoreClient(coreUrl(port, TOKEN, 7));
        const [windowTicks, plain] = yield* Effect.all(
          [window.ticks({ intervalMs: 5 }).pipe(Stream.take(3), Stream.runCollect), Effect.promise(() => plainTicks(coreUrl(port, TOKEN), 3, { origin: ORIGIN }))],
          { concurrency: 'unbounded' },
        );
        assert.deepEqual([...windowTicks], [0, 1, 2]);
        assert.deepEqual(plain, [0, 1, 2]);
      }),
    ),
  );
});

test('Core refuses a missing, wrong or query-string token, a foreign Origin, another protocol version, a scoped window and a missing scope', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const port = yield* startCore;
        const base = `ws://127.0.0.1:${port}/ws`;
        const statuses = yield* Effect.promise(() =>
          Promise.all([
            upgradeStatus(`${base}?v=${Capabilities.PROTOCOL_VERSION}`),
            upgradeStatus(coreUrl(port, 'guess')),
            upgradeStatus(coreUrl(port, TOKEN), { origin: 'http://evil.test' }),
            upgradeStatus(`${base}?v=${Capabilities.PROTOCOL_VERSION + 1}#${TOKEN}`),
            upgradeStatus(`${base}?v=${Capabilities.PROTOCOL_VERSION}&token=${TOKEN}`),
            upgradeStatus(coreUrl(port, READ_TOKEN, 7)),
            upgradeStatus(coreUrl(port, mintDeviceToken(TOKEN, { id: 'd1', name: 'Laptop', scopes: ['read'] }), 7)),
            upgradeStatus(coreUrl(port, mintDeviceToken('not-cores-token', { id: 'd1', name: 'Laptop', scopes: ['read'] }))),
            upgradeStatus(coreUrl(port, mintDeviceToken(TOKEN, { id: 'd1', name: 'Laptop', scopes: ['read'] }, Date.now() - 3_600_000))),
            upgradeStatus(coreUrl(port, TOKEN), { origin: ORIGIN }),
          ]),
        );
        assert.deepEqual(statuses, [401, 401, 403, 426, 401, 403, 403, 401, 401, 'open']);

        const reader = yield* makeCoreClient(coreUrl(port, READ_TOKEN));
        assert.equal(yield* reader.ping(), 'pong');
        const exit = yield* reader.run({ command: 'true', args: [] }).pipe(Effect.exit);
        assert.ok(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof Unauthorized);
        const device = yield* makeCoreClient(coreUrl(port, mintDeviceToken(TOKEN, { id: 'd1', name: 'Laptop', scopes: ['read', 'operate', 'manage', 'code', 'terminal'] })));
        const local = yield* device['docs.get']({ table: 'settings', key: 'agent' }).pipe(Effect.exit);
        assert.ok(Exit.isFailure(local) && (Cause.squash(local.cause) as Unauthorized).scope === 'local', 'every scope a device can hold still leaves out `local`');
      }),
    ),
  );
});

test("a window's host call reaches the client serving its capability, with the window's id and encoded args", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const port = yield* startCore;
        const window = makeHostCaller(yield* makeCoreClient(coreUrl(port, TOKEN, 7)));
        yield* Effect.promise(() => assert.rejects(() => window('notify.show', [{ title: 'Done' }]), /No connected client offers notify/));

        const shown: Capabilities.CapabilityCall[] = [];
        const main = yield* makeCoreClient(coreUrl(port, TOKEN));
        yield* serveCapabilities(main, ['notify'], async (call) => void shown.push(call)).pipe(Effect.forkScoped);
        yield* Effect.sleep(50);
        yield* Effect.promise(() => window('notify.show', [{ title: 'Done', body: 'Thread finished' }]));
        assert.deepEqual(shown.map(({ capability, method, args, windowId }) => ({ capability, method, args, windowId })), [
          { capability: 'notify', method: 'notify.show', args: [{ title: 'Done', body: 'Thread finished' }], windowId: 7 },
        ]);
        // Decoding in Core is what vets a call: main never sees one with bad arguments.
        yield* Effect.promise(() => assert.rejects(() => window('notify.show', [{ title: 5 }])));
        assert.equal(shown.length, 1);
      }),
    ),
  );
});

test('killing Core reconnects every client, and main registers its capabilities again', { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-core-'));
  const env = { ...process.env, MOCHI_LOG_FILE: path.join(dir, 'core.log'), MOCHI_CORE_TOKEN: TOKEN, MOCHI_CORE_PORT: String(await freePort()), MOCHI_CORE_DATA: dir };
  const startProcess = () => spawn(process.execPath, [path.join(import.meta.dirname, 'core.ts')], { env, stdio: 'inherit' });
  let core = startProcess();
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const url = coreUrl(Number(env.MOCHI_CORE_PORT), TOKEN);
          const [first, second] = yield* Effect.all([makeCoreClient(url), makeCoreClient(url)]);
          const main = yield* makeCoreClient(url);
          let shown = 0;
          yield* serveCapabilities(main, ['notify'], async () => void shown++).pipe(Effect.forkScoped);
          const window = makeHostCaller(first);
          assert.deepEqual(yield* retrying(Effect.all([first.ping(), second.ping()])), ['pong', 'pong']);
          yield* retrying(Effect.tryPromise(() => window('notify.show', [{ title: 'before' }])));

          core.kill('SIGKILL');
          yield* Effect.promise(() => new Promise((resolve) => core.once('exit', resolve)));
          core = startProcess();

          assert.deepEqual(yield* retrying(Effect.all([first.ping(), second.ping()])), ['pong', 'pong']);
          yield* retrying(Effect.tryPromise(() => window('notify.show', [{ title: 'after' }])));
          assert.equal(shown, 2);
        }),
      ),
    );
  } finally {
    // Windows keeps Core's open `mochi.db` locked until the process is gone.
    if (core.exitCode === null && core.signalCode === null) await new Promise((resolve) => (core.once('exit', resolve), core.kill('SIGKILL')));
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/** A call made while Core is down fails; the same client succeeds once it has redialled (and main re-registered). 30s: a cold `node core.ts` takes seconds on a CI runner. */
const retrying = <A, E>(effect: Effect.Effect<A, E>) => effect.pipe(Effect.retry({ times: 300, schedule: Schedule.spaced(100) }));

function freePort() {
  return new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
