import assert from 'node:assert/strict';
import test from 'node:test';
import { Cause, Context, Effect, Exit, Fiber, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import sodium from 'libsodium-wrappers';
import { Capabilities, type Relay } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '@mochi/core/client';
import { makeHostCaller, serveCapabilities } from '@mochi/core/hostClient';
import { makeDeviceClient } from '@mochi/core/remote/device';
import { queuedReader, type Link, type RawLink } from '@mochi/core/remote/link';
import { mintDeviceToken } from '@mochi/core/remote/token';
import { Unauthorized } from '@mochi/core/rpc';
import { layerCore } from '@mochi/core/server';
import type { Scope } from '../../src/host/types/remote.ts';
import type { DeviceKeys } from './crypto/keys.ts';
import { deviceId, PairingRefused, secureAsDevice, secureAsMachine, type MachineSide } from './pairing.ts';
import { startRemoteServer } from './server.ts';

await sodium.ready;

const TOKEN = 'core-token';
const keypair = (): DeviceKeys => sodium.crypto_sign_keypair();

/** Two ends of one relay channel: what one sends the other reads, in order. */
function pipe() {
  const ends = [0, 1].map(() => {
    const reader = queuedReader();
    const closes: ((code: number, reason: string) => void)[] = [];
    let isOpen = true;
    return { reader, closes, isOpen: () => isOpen, shut: (code: number, reason: string) => isOpen && ((isOpen = false), closes.forEach((c) => c(code, reason))) };
  });
  const link = (self: number): RawLink => ({
    send: (bytes) => ends[self].isOpen() && queueMicrotask(() => ends[1 - self].reader.deliver(bytes)),
    close: (code, reason) => ends.forEach((e) => e.shut(code, reason)),
    onMessage: ends[self].reader.set,
    onClose: (listener) => void ends[self].closes.push(listener),
    isOpen: () => ends[self].isOpen(),
  });
  return { device: link(0), machine: link(1) };
}

/**
 * Core in-process with a window client, and this computer's remote server with one paired device. The device reaches it
 * through a fake relay: each dial is a fresh channel, paired and encrypted for real, then tunnelled into Core.
 */
const setup = (scopes: Scope[]) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(layerCore({ port: 0, tokens: new Map([[TOKEN, Capabilities.allScopes]]), origins: [] }));
    const port = (Context.get(context, HttpServer.HttpServer).address as { port: number }).port;
    const window = yield* makeCoreClient(coreUrl(port, TOKEN, 7));
    const machineKeys = keypair();
    const deviceKeys = keypair();
    const device = { id: deviceId(deviceKeys.publicKey), name: 'Laptop', publicKey: sodium.to_base64(deviceKeys.publicKey, sodium.base64_variants.ORIGINAL), scopes, pairedAt: 1 };
    const side: MachineSide = { keys: machineKeys, find: (id) => (id === device.id ? device : undefined), refresh: async () => {}, approve: async () => false, add: async () => undefined };
    const rejected: string[] = [];
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        startRemoteServer({
          hosts: [],
          port: 0,
          secure: (raw, origin) => secureAsMachine(raw, origin, side),
          coreFor: async (grant) => ({ url: coreUrl(port, '').split('#')[0]!, token: mintDeviceToken(TOKEN, grant) }),
          machineName: () => 'Studio',
          onRejected: (_device, reason) => void rejected.push(reason),
        }),
      ),
      (server) => Effect.promise(() => server.close()),
    );
    const dial = () => {
      const ends = pipe();
      server.attach(ends.machine);
      return ends.device;
    };
    const secure = (raw: RawLink) => secureAsDevice(raw, deviceKeys, machineKeys.publicKey, 'Laptop', true);
    const welcomes: Relay.WelcomeFrame[] = [];
    const client = yield* makeDeviceClient({
      routes: () => [{ kind: 'relay', open: async () => dial() }],
      secure,
      isRefusal: (error) => error instanceof PairingRefused,
      onWelcome: (welcome) => void welcomes.push(welcome),
      onOffline: () => {},
      onRefused: (reason) => assert.fail(reason),
    });
    return { window, host: makeHostCaller(window), client, welcomes, rejected, dial, secure };
  });

const INDEX = JSON.stringify({ v: 1, now: 0, seq: 0, checkpointSeq: 0, queue: [], threadIds: ['t1'] });
const threadFile = (title: string) => JSON.stringify({ v: 1, thread: { id: 't1', title, status: 'running', activity: [{ who: 'harness', kind: 'tool', text: 'Edited a.ts', patch: '+secret' }] }, checkpoints: [] });
const run = <A, E>(effect: Effect.Effect<A, E, import('effect').Scope.Scope>) => Effect.runPromise(Effect.scoped(effect));

test('a paired device reads the same `thread` stream a window does, through a relay channel', async () => {
  await run(
    Effect.gen(function* () {
      const { window, host, client, welcomes } = yield* setup(['read', 'operate', 'manage', 'code']);
      yield* Effect.promise(() => host('data.save', [INDEX, { t1: threadFile('Fix login') }]));
      const read = (from: typeof window) => from.thread({ threadId: 't1', afterSequence: 0 }).pipe(Stream.take(2), Stream.runCollect);
      const both = yield* Effect.forkChild(Effect.all([read(window), read(client)], { concurrency: 'unbounded' }));
      yield* Effect.sleep(300);
      yield* Effect.promise(() => host('data.save', [INDEX, { t1: threadFile('Fix SSO login') }]));
      const [fromWindow, fromDevice] = yield* Fiber.join(both);
      assert.deepEqual([...fromDevice], [...fromWindow]);
      assert.deepEqual(
        [...fromDevice].map((item) => item._tag === 'snapshot' && (item.saved as { thread: { title: string } }).thread.title),
        ['Fix login', 'Fix SSO login'],
      );
      assert.equal(welcomes[0]?.machineName, 'Studio');
    }),
  );
});

test('a device command runs where main serves `remote`, named after the device; a read-scoped device is refused it', async () => {
  await run(
    Effect.gen(function* () {
      const full = yield* setup(['read', 'operate']);
      const runs: unknown[] = [];
      yield* serveCapabilities(full.window, ['remote'], async (call) => (runs.push(call.args[0]), { isOk: true })).pipe(Effect.forkScoped);
      yield* Effect.sleep(50);
      assert.deepEqual(yield* full.client['device.command']({ command: { type: 'interrupt', threadId: 't1' } }), { isOk: true });
      assert.deepEqual(runs, [{ id: (runs[0] as { id: string }).id, deviceName: 'Laptop', command: { type: 'interrupt', threadId: 't1' } }]);

      const reader = yield* setup(['read']);
      yield* Effect.promise(() => reader.host('data.save', [INDEX, { t1: threadFile('Fix login') }]));
      const refused = yield* reader.client['device.command']({ command: { type: 'interrupt', threadId: 't1' } }).pipe(Effect.exit);
      assert.ok(Exit.isFailure(refused));
      const error = Cause.squash(refused.cause);
      assert.ok(error instanceof Unauthorized && error.scope === 'operate', String(error));
      // It still reads, without the diffs `code` would show it.
      const [snapshot] = yield* reader.client.thread({ threadId: 't1', afterSequence: 0 }).pipe(Stream.take(1), Stream.runCollect);
      const saved = snapshot?._tag === 'snapshot' ? (snapshot.saved as { thread: { activity: object[] }; checkpoints?: unknown }) : undefined;
      assert.deepEqual(saved?.thread.activity, [{ who: 'harness', kind: 'tool', text: 'Edited a.ts' }]);
      assert.equal(saved?.checkpoints, undefined);
    }),
  );
});

test('terminal output is pushed to a device in order; a `read`-only device is refused the stream', async () => {
  await run(
    Effect.gen(function* () {
      const { window, client } = yield* setup(['read', 'terminal']);
      yield* window['terminal.open']({ terminalId: 'p1', threadId: 't1' });
      yield* window['terminal.feed']({ terminalId: 'p1', data: 'one ' });
      const chunks = yield* client['terminal.output']({ terminalId: 'p1', threadId: 't1', after: 0 }).pipe(Stream.runCollect, Effect.forkChild);
      yield* Effect.sleep(200);
      yield* window['terminal.feed']({ terminalId: 'p1', data: 'two ' });
      yield* window['terminal.feed']({ terminalId: 'p1', data: 'three' });
      yield* Effect.sleep(100);
      yield* window['terminal.exit']({ terminalId: 'p1', exitCode: 0 });
      const received = [...(yield* Fiber.join(chunks))];
      assert.equal(received.map((c) => c.data).join(''), 'one two three');
      assert.equal(received.at(-1)?.exitCode, 0);
      assert.ok(received.length > 1, 'pushed in more than one piece, not read once');
      // Resuming from an offset skips what it already has; another thread's id gets nothing.
      const [tail] = yield* client['terminal.output']({ terminalId: 'p1', threadId: 't1', after: 4 }).pipe(Stream.take(1), Stream.runCollect);
      assert.equal(tail?.data, 'two three');
      const other = yield* client['terminal.output']({ terminalId: 'p1', threadId: 't2', after: 0 }).pipe(Stream.runCollect, Effect.exit);
      assert.ok(Exit.isFailure(other));

      const reader = yield* setup(['read']);
      yield* reader.window['terminal.open']({ terminalId: 'p1', threadId: 't1' });
      const refused = yield* reader.client['terminal.output']({ terminalId: 'p1', threadId: 't1', after: 0 }).pipe(Stream.runCollect, Effect.exit);
      assert.ok(Exit.isFailure(refused));
      const error = Cause.squash(refused.cause);
      assert.ok(error instanceof Unauthorized && error.scope === 'terminal', String(error));
    }),
  );
});

test('malformed frames from a device are refused and logged', async () => {
  await run(
    Effect.gen(function* () {
      const { dial, secure, rejected } = yield* setup(['read']);
      const open = async (first: string) => {
        const link = await secure(dial());
        const closed = new Promise<void>((resolve) => link.onClose(resolve));
        const replies: string[] = [];
        link.onMessage((text) => replies.push(text));
        link.send(first);
        return { link, closed, replies };
      };

      const badHello = yield* Effect.promise(() => open('{"type":"hello","version":3}'));
      yield* Effect.promise(() => badHello.closed);
      assert.match(badHello.replies[0] ?? '', /"refused".*protocol 4/);

      // The old protocol's command frame, after a good hello: no longer anything Core speaks.
      const old: { link: Link; closed: Promise<void>; replies: string[] } = yield* Effect.promise(() => open(JSON.stringify({ type: 'hello', version: 4 })));
      yield* Effect.promise(() => until(() => old.replies.some((r) => r.includes('"welcome"'))));
      old.link.send(JSON.stringify({ type: 'command', id: 'c1', command: { type: 'catalog' } }));
      yield* Effect.promise(() => old.closed);
      assert.equal(rejected.length, 2);
      assert.match(rejected[0]!, /protocol 4/);
      assert.match(rejected[1]!, /Malformed frame: \{"type":"command"/);
    }),
  );
});

async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(condition());
}
