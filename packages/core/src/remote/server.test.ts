import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Stream,
} from 'effect';
import { HttpServer } from 'effect/http';
import sodium from 'libsodium-wrappers';
import { Capabilities, type Relay } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '../client.ts';
import { serveCapabilities } from '../hostClient.ts';
import { makeDeviceClient, openLan, type Route } from './device.ts';
import { queuedReader, type Link, type RawLink } from './link.ts';
import { mintDeviceToken } from './token.ts';
import { networkChanged } from './reconnect.ts';
import WebSocket from 'ws';
import { Unauthorized } from '../rpc.ts';
import type { ThreadItem } from '@mochi/domain';
import { layerCore } from '../server.ts';
import type { Scope } from '../../../../apps/desktop/src/host/types/remote.ts';
import type { DeviceKeys } from './session.ts';
import {
  deviceId,
  PairingRefused,
  secureAsDevice,
  secureAsMachine,
  type MachineSide,
} from './pairing.ts';
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
    return {
      reader,
      closes,
      isOpen: () => isOpen,
      shut: (code: number, reason: string) =>
        isOpen && ((isOpen = false), closes.forEach((c) => c(code, reason))),
    };
  });
  const link = (self: number): RawLink => ({
    send: (bytes) =>
      ends[self].isOpen() &&
      queueMicrotask(() => ends[1 - self].reader.deliver(bytes)),
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
/**
 * `hosts`: the server listens there and the device dials its addresses directly (read on each attempt). `hasRelay`: the relay
 * route too; it is the only one without `hosts`.
 */
const setup = (
  scopes: Scope[],
  {
    hosts,
    hasRelay = !hosts,
    alsoDial = [],
  }: { hosts?: string[]; hasRelay?: boolean; alsoDial?: string[] } = {},
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      layerCore({
        port: 0,
        tokens: new Map([[TOKEN, Capabilities.allScopes]]),
        origins: [],
      }),
    );
    const port = (
      Context.get(context, HttpServer.HttpServer).address as { port: number }
    ).port;
    const window = yield* makeCoreClient(coreUrl(port, TOKEN, 7));
    const machineKeys = keypair();
    const deviceKeys = keypair();
    const device = {
      id: deviceId(deviceKeys.publicKey),
      name: 'Laptop',
      publicKey: sodium.to_base64(
        deviceKeys.publicKey,
        sodium.base64_variants.ORIGINAL,
      ),
      scopes,
      pairedAt: 1,
    };
    const side: MachineSide = {
      keys: machineKeys,
      find: (id) => (id === device.id ? device : undefined),
      refresh: async () => {},
      approve: async () => false,
      add: async () => undefined,
    };
    const rejected: string[] = [];
    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        startRemoteServer({
          hosts: hosts ?? [],
          port: 0,
          secure: (raw, origin) => secureAsMachine(raw, origin, side),
          coreFor: async (grant) => ({
            url: coreUrl(port, '').split('#')[0]!,
            token: mintDeviceToken(TOKEN, grant),
          }),
          backend: async (scopes) => ({
            id: 'studio',
            name: 'Studio',
            kind: 'mac',
            appVersion: '0.0.0',
            protocolVersion: Capabilities.PROTOCOL_VERSION,
            capabilities: [],
            scopes,
          }),
          onRejected: (_device, reason) => void rejected.push(reason),
        }),
      ),
      (server) => Effect.promise(() => server.close()),
    );
    /** The relay as the device sees it: `down` drops every open channel and refuses new ones until `up`. */
    const network = { isDown: false, links: new Set<RawLink>() };
    const dial = () => {
      const ends = pipe();
      server.attach(ends.machine);
      network.links.add(ends.device);
      return ends.device;
    };
    const down = () => {
      network.isDown = true;
      for (const link of network.links) link.close(1006, 'Network lost');
      network.links.clear();
    };
    const up = () => void (network.isDown = false);
    const secure = (raw: RawLink) =>
      secureAsDevice(raw, deviceKeys, machineKeys.publicKey, 'Laptop', true);
    const welcomes: Relay.WelcomeFrame[] = [];
    /** Each welcome, to wait for one; and each dial that found no way in (the relay down, or no address listening). */
    const welcomed = yield* Queue.unbounded<Route['kind']>();
    const turnedAway = yield* Queue.unbounded<void>();
    const relay: Route = {
      kind: 'relay',
      open: async () => {
        if (network.isDown) {
          Queue.offerUnsafe(turnedAway, undefined);
          throw new Error('getaddrinfo ENOTFOUND');
        }
        return dial();
      },
    };
    const client = yield* makeDeviceClient({
      routes: () => {
        const direct = [...(hosts ? server.addresses : []), ...alsoDial].map(
          (address) => ({
            kind: 'lan' as const,
            open: () => openLan(address),
          }),
        );
        if (hosts && !direct.length && !hasRelay)
          Queue.offerUnsafe(turnedAway, undefined);
        return { direct, ...(hasRelay && { relay }) };
      },
      secure,
      isRefusal: (error) => error instanceof PairingRefused,
      onWelcome: (welcome, route) => {
        welcomes.push(welcome);
        Queue.offerUnsafe(welcomed, route);
      },
      onOffline: () => {},
      onRefused: (reason) => assert.fail(reason),
    });
    return {
      window,
      client,
      welcomes,
      rejected,
      dial,
      secure,
      down,
      up,
      server,
      deviceId: device.id,
      welcomed,
      turnedAway,
    };
  });

type Window = Effect.Success<ReturnType<typeof makeCoreClient>>;
const command = (window: Window, threadId: string | null, payload: object) =>
  window['events.append']({ type: 'command', threadId, payload });
type SavedActivity = {
  thread: { activity?: { kind: string; text: string; patch?: string }[] };
} | null;
/** A thread in Core's projection with an edit whose patch only `code` may read; done once Core has written the snapshot holding the patch. */
const seed = (window: Window, title: string) =>
  Effect.gen(function* () {
    yield* command(window, null, {
      type: 'create',
      spaceId: 's',
      title,
      name: title,
      provider: 'claude',
      project: null,
      isLive: true,
    });
    yield* window['events.append']({
      type: 'agent.tool',
      threadId: 'new-1',
      payload: {
        threadId: 'new-1',
        type: 'tool',
        id: 'e1',
        phase: 'start',
        text: 'Edited a.ts',
      },
    });
    yield* window['events.append']({
      type: 'agent.tool',
      threadId: 'new-1',
      payload: {
        threadId: 'new-1',
        type: 'tool',
        id: 'e1',
        phase: 'end',
        text: 'Edited a.ts',
        patch: '+secret',
      },
    });
    yield* window.thread({ threadId: 'new-1', afterSequence: 0 }).pipe(
      Stream.filter(
        (item) =>
          item._tag === 'snapshot' &&
          !!(item.saved as SavedActivity)?.thread.activity?.some(
            (e) => e.patch,
          ),
      ),
      Stream.take(1),
      Stream.runDrain,
    );
  });
const snapshots = (stream: Stream.Stream<ThreadItem, unknown>, n: number) =>
  stream.pipe(
    Stream.filter((item) => item._tag === 'snapshot'),
    Stream.take(n),
    Stream.runCollect,
  );

it.live(
  'a paired device reads the same `thread` stream a window does, through a relay channel',
  () =>
    Effect.gen(function* () {
      const { window, client, welcomes } = yield* setup([
        'read',
        'operate',
        'manage',
        'code',
      ]);
      yield* seed(window, 'Fix login');
      // A stream's first snapshot means Core is already publishing the thread's later saves to it.
      const read = (from: typeof window) =>
        Effect.gen(function* () {
          const subscribed = yield* Deferred.make<void>();
          const collected = snapshots(
            from
              .thread({ threadId: 'new-1', afterSequence: 0 })
              .pipe(Stream.tap(() => Deferred.succeed(subscribed, undefined))),
            2,
          );
          return { subscribed, collected };
        });
      const fromBoth = [yield* read(window), yield* read(client)];
      const both = yield* Effect.forkChild(
        Effect.all(
          fromBoth.map((r) => r.collected),
          { concurrency: 'unbounded' },
        ),
      );
      for (const { subscribed } of fromBoth) yield* Deferred.await(subscribed);
      yield* command(window, 'new-1', {
        type: 'rename',
        threadId: 'new-1',
        title: 'Fix SSO login',
      });
      const [fromWindow, fromDevice] = yield* Fiber.join(both);
      assert.deepEqual([...fromDevice], [...fromWindow]);
      assert.deepEqual(
        [...fromDevice].map(
          (item) =>
            item._tag === 'snapshot' &&
            (item.saved as { thread: { title: string } }).thread.title,
        ),
        ['Fix login', 'Fix SSO login'],
      );
      assert.equal(welcomes[0]?.backend.name, 'Studio');
    }),
);

it.live(
  'a device command that needs a window runs where main serves `remote`, named after the device; Core applies a store command itself; a read-scoped device is refused it',
  () =>
    Effect.gen(function* () {
      const full = yield* setup(['read', 'operate']);
      const runs: unknown[] = [];
      yield* serveCapabilities(
        full.window,
        ['remote'],
        async (call) => (runs.push(call.args[0]), { isOk: true }),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      // Core starts one socket's handlers in arrival order, so the ping's reply comes after the serve request registered.
      yield* full.window.ping();
      assert.deepEqual(
        yield* full.client['device.command']({ command: { type: 'catalog' } }),
        { isOk: true },
      );
      assert.deepEqual(runs, [
        {
          id: (runs[0] as { id: string }).id,
          deviceName: 'Laptop',
          command: { type: 'catalog' },
        },
      ]);
      // An interrupt is a store action: Core applies it, no window hears of it.
      yield* seed(full.window, 'Fix login');
      assert.deepEqual(
        yield* full.client['device.command']({
          command: { type: 'interrupt', threadId: 'new-1' },
        }),
        { isOk: true },
      );
      assert.equal(runs.length, 1);
      assert.deepEqual(
        yield* full.client['device.command']({
          command: { type: 'interrupt', threadId: 'nope' },
        }),
        { isOk: false, error: 'No such thread on this machine' },
      );

      const reader = yield* setup(['read']);
      yield* seed(reader.window, 'Fix login');
      const refused = yield* reader.client['device.command']({
        command: { type: 'interrupt', threadId: 't1' },
      }).pipe(Effect.exit);
      assert.ok(Exit.isFailure(refused));
      const error = Cause.squash(refused.cause);
      assert.ok(
        error instanceof Unauthorized && error.scope === 'operate',
        String(error),
      );
      // It still reads, without the diffs `code` would show it.
      const [snapshot] = yield* snapshots(
        reader.client.thread({ threadId: 'new-1', afterSequence: 0 }),
        1,
      );
      const saved =
        snapshot?._tag === 'snapshot'
          ? (snapshot.saved as {
              thread: { activity: { kind: string; text: string }[] };
              checkpoints?: unknown;
            })
          : undefined;
      assert.deepEqual(
        saved?.thread.activity.map((e) => [e.kind, e.text, 'patch' in e]),
        [
          ['message', 'Fix login', false],
          ['tool', 'Edited a.ts', false],
        ],
      );
      assert.equal(saved?.checkpoints, undefined);
    }),
);

it.live(
  'terminal output is pushed to a device in order; a `read`-only device is refused the stream',
  () =>
    Effect.gen(function* () {
      const { window, client } = yield* setup(['read', 'terminal']);
      yield* window['terminal.open']({ terminalId: 'p1', threadId: 't1' });
      yield* window['terminal.feed']({ terminalId: 'p1', data: 'one ' });
      let output = '';
      const arrived = {
        'one ': yield* Deferred.make<void>(),
        'one two three': yield* Deferred.make<void>(),
      };
      const chunks = yield* client['terminal.output']({
        terminalId: 'p1',
        threadId: 't1',
        after: 0,
      }).pipe(
        Stream.tap((chunk) =>
          Effect.sync(() => {
            output += chunk.data;
            if (output in arrived)
              Deferred.doneUnsafe(
                arrived[output as keyof typeof arrived],
                Effect.void,
              );
          }),
        ),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(arrived['one ']);
      yield* window['terminal.feed']({ terminalId: 'p1', data: 'two ' });
      yield* window['terminal.feed']({ terminalId: 'p1', data: 'three' });
      yield* Deferred.await(arrived['one two three']);
      yield* window['terminal.exit']({ terminalId: 'p1', exitCode: 0 });
      const received = [...(yield* Fiber.join(chunks))];
      assert.equal(received.map((c) => c.data).join(''), 'one two three');
      assert.equal(received.at(-1)?.exitCode, 0);
      assert.ok(
        received.length > 1,
        'pushed in more than one piece, not read once',
      );
      // Resuming from an offset skips what it already has; another thread's id gets nothing.
      const [tail] = yield* client['terminal.output']({
        terminalId: 'p1',
        threadId: 't1',
        after: 4,
      }).pipe(Stream.take(1), Stream.runCollect);
      assert.equal(tail?.data, 'two three');
      const other = yield* client['terminal.output']({
        terminalId: 'p1',
        threadId: 't2',
        after: 0,
      }).pipe(Stream.runCollect, Effect.exit);
      assert.ok(Exit.isFailure(other));

      const reader = yield* setup(['read']);
      yield* reader.window['terminal.open']({
        terminalId: 'p1',
        threadId: 't1',
      });
      const refused = yield* reader.client['terminal.output']({
        terminalId: 'p1',
        threadId: 't1',
        after: 0,
      }).pipe(Stream.runCollect, Effect.exit);
      assert.ok(Exit.isFailure(refused));
      const error = Cause.squash(refused.cause);
      assert.ok(
        error instanceof Unauthorized && error.scope === 'terminal',
        String(error),
      );
    }),
);

it.live('malformed frames from a device are refused and logged', () =>
  Effect.gen(function* () {
    const { dial, secure, rejected } = yield* setup(['read']);
    const open = async (first: string) => {
      const link = await secure(dial());
      const closed = new Promise<void>((resolve) => link.onClose(resolve));
      const replies: string[] = [];
      let welcome = () => {};
      const welcomed = new Promise<void>((resolve) => (welcome = resolve));
      link.onMessage((text) => {
        replies.push(text);
        if (text.includes('"welcome"')) welcome();
      });
      link.send(first);
      return { link, closed, replies, welcomed };
    };

    const badHello = yield* Effect.promise(() =>
      open('{"type":"hello","version":7}'),
    );
    yield* Effect.promise(() => badHello.closed);
    assert.match(badHello.replies[0] ?? '', /"refused".*protocol 8/);

    // The old protocol's command frame, after a good hello: no longer anything Core speaks.
    const old: {
      link: Link;
      closed: Promise<void>;
      replies: string[];
      welcomed: Promise<void>;
    } = yield* Effect.promise(() =>
      open(JSON.stringify({ type: 'hello', version: 8 })),
    );
    yield* Effect.promise(() => old.welcomed);
    old.link.send(
      JSON.stringify({
        type: 'command',
        id: 'c1',
        command: { type: 'catalog' },
      }),
    );
    yield* Effect.promise(() => old.closed);
    assert.equal(rejected.length, 2);
    assert.match(rejected[0]!, /protocol 8/);
    assert.match(rejected[1]!, /Malformed frame: \{"type":"command"/);
  }),
);

it.live(
  'a device comes back by itself after the relay drops and refuses it for a while',
  () =>
    Effect.gen(function* () {
      const { client, down, up, welcomed, turnedAway } = yield* setup(['read']);
      yield* Queue.take(welcomed);
      yield* client.ping();
      down();
      yield* Queue.take(turnedAway);
      yield* Queue.take(turnedAway);
      up();
      yield* Queue.take(welcomed);
      yield* client.ping();
    }),
  30_000,
);

it.live(
  'a device on the LAN comes back by itself after the server stops listening and starts again',
  () =>
    Effect.gen(function* () {
      const { client, server, deviceId, welcomed, turnedAway } = yield* setup(
        ['read'],
        { hosts: ['127.0.0.1'] },
      );
      yield* Queue.take(welcomed);
      yield* client.ping();
      yield* Effect.promise(() => server.rebind([]));
      server.disconnect(deviceId);
      yield* Queue.take(turnedAway);
      yield* Effect.promise(() => server.rebind(['127.0.0.1']));
      yield* Queue.take(welcomed);
      yield* client.ping();
    }),
  30_000,
);

it.live(
  "the machine's address changes: it listens on the new one, the old one is gone, and the device reaches it there",
  () =>
    Effect.gen(function* () {
      const { client, server, deviceId, welcomed } = yield* setup(['read'], {
        hosts: ['127.0.0.1'],
      });
      yield* Queue.take(welcomed);
      yield* client.ping();
      const [old] = server.addresses;
      yield* Effect.promise(() => server.rebind(['::1']));
      assert.deepEqual(
        server.addresses.map((a) => a.startsWith('[::1]:')),
        [true],
      );
      const refused = yield* Effect.promise(() =>
        openLan(old!).then(
          () => 'answered',
          () => 'refused',
        ),
      );
      assert.equal(refused, 'refused');
      server.disconnect(deviceId);
      yield* Queue.take(welcomed);
      yield* client.ping();
    }),
  30_000,
);

it.live('the direct route wins over the relay when both answer', () =>
  Effect.gen(function* () {
    const { client, welcomed } = yield* setup(['read'], {
      hosts: ['127.0.0.1'],
      hasRelay: true,
    });
    assert.equal(yield* Queue.take(welcomed), 'lan');
    yield* client.ping();
  }),
);

it.live('with no direct route answering, the relay carries the session', () =>
  Effect.gen(function* () {
    // Port 1 refuses: an address the machine had on another network.
    const { client, welcomed } = yield* setup(['read'], {
      hasRelay: true,
      alsoDial: ['127.0.0.1:1'],
    });
    assert.equal(yield* Queue.take(welcomed), 'relay');
    yield* client.ping();
  }),
);

it.live(
  'a session on the relay moves to a direct route once one answers, losing and repeating nothing',
  () =>
    Effect.gen(function* () {
      const { window, client, server, welcomed } = yield* setup(['read'], {
        hosts: [],
        hasRelay: true,
      });
      assert.equal(yield* Queue.take(welcomed), 'relay');
      yield* seed(window, 'Fix login');
      // Follows the thread the way a followed machine's mirror does: after a drop, from the last sequence, once welcomed again.
      const sequences: number[] = [];
      const titles: string[] = [];
      const resumedOn: string[] = [];
      const first = yield* Deferred.make<void>();
      const last = yield* Deferred.make<void>();
      let after = 0;
      const follow = Stream.suspend(() =>
        client.thread({ threadId: 'new-1', afterSequence: after }),
      ).pipe(
        Stream.runForEach((item) =>
          Effect.sync(() => {
            const sequence =
              item._tag === 'snapshot' ? item.sequence : item.event.sequence;
            sequences.push(sequence);
            after = sequence;
            if (item._tag !== 'snapshot') return;
            const { title } = (item.saved as { thread: { title: string } })
              .thread;
            if (titles.at(-1) !== title) titles.push(title);
            Deferred.doneUnsafe(first, Effect.void);
            if (title === 'C') Deferred.doneUnsafe(last, Effect.void);
          }),
        ),
        Effect.catch(() =>
          Queue.take(welcomed).pipe(
            Effect.map((route) => void resumedOn.push(route)),
          ),
        ),
        Effect.forever,
      );
      yield* Effect.forkChild(follow);
      yield* Deferred.await(first);
      const rename = (title: string) =>
        command(window, 'new-1', { type: 'rename', threadId: 'new-1', title });
      yield* rename('A');
      yield* Effect.promise(() => server.rebind(['127.0.0.1']));
      networkChanged();
      yield* rename('B');
      yield* rename('C');
      yield* Deferred.await(last);
      assert.deepEqual(
        sequences,
        [...new Set(sequences)].sort((a, b) => a - b),
        'every sequence once, in order',
      );
      // Core may fold saves together; what it streamed last is the last rename.
      assert.equal(titles.at(-1), 'C');
      assert.deepEqual(
        resumedOn,
        ['lan'],
        'it moved once, to the direct route',
      );
      yield* client.ping();
      assert.ok(server.devices().length >= 1);
    }),
  30_000,
);

it.live(
  'a direct connection that skips the pairing exchange is refused before anything reaches Core',
  () =>
    Effect.gen(function* () {
      const { server } = yield* setup(['read'], { hosts: ['127.0.0.1'] });
      const closed = yield* Effect.promise(
        () =>
          new Promise<{ code: number; replies: string[] }>((resolve) => {
            const replies: string[] = [];
            const ws = new WebSocket(`ws://${server.addresses[0]}`);
            ws.on('open', () =>
              ws.send(
                Buffer.from(
                  JSON.stringify({ type: 'hello', version: 6 }),
                  'utf8',
                ),
              ),
            );
            ws.on('message', (data: Buffer) =>
              replies.push(data.toString('utf8')),
            );
            ws.on('close', (code) => resolve({ code, replies }));
          }),
      );
      assert.equal(closed.code, 4401);
      assert.ok(
        closed.replies.every((r) => !r.includes('welcome')),
        'no welcome in clear',
      );
    }),
);
