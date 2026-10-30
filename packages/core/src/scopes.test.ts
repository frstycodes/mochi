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
  Stream,
} from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities, Relay } from '@mochi/schema';
import { COMMAND_TYPE } from '@mochi/domain';
import { coreUrl, makeCoreClient } from './client.ts';
import { directCall } from './remote/adapter.ts';
import { mintDeviceToken } from './remote/token.ts';
import { visibleSnapshot } from './remote/visible.ts';
import { CoreWsRpcs, Unauthorized } from './rpc.ts';
import { isClassified, scopeOf } from './scopes.ts';
import { layerCore, refusal } from './server.ts';

const TOKEN = 'local-token';
const TAGS = [...CoreWsRpcs.requests.keys()];
/** Every scope a device can hold: never `local`. */
const DEVICE = Relay.Scope.literals;
const RPC_TAGS = TAGS.filter((tag) => tag !== 'device.command');

it('every RPC Core serves has a scope of its own', () => {
  assert.ok(TAGS.length > 250, `only ${TAGS.length} tags`);
  assert.deepEqual(
    TAGS.filter((tag) => !isClassified(tag)),
    [],
  );
});

it('an unclassified tag needs `local`, so no device reaches it', () => {
  for (const tag of ['nope', 'nope.never', 'agent.notYet', 'git.'])
    assert.equal(scopeOf(tag), 'local', tag);
  assert.equal(isClassified('agent.notYet'), false);
  assert.ok(refusal(DEVICE, 'agent.notYet') instanceof Unauthorized);
  assert.equal(refusal(Capabilities.allScopes, 'agent.notYet'), undefined);
});

it('each RPC is refused to every scope but its own, and allowed with it', () => {
  for (const tag of RPC_TAGS) {
    const needed = scopeOf(tag);
    for (const held of Capabilities.allScopes.filter((s) => s !== needed)) {
      assert.equal(refusal([held], tag)?.scope, needed, `${tag} with ${held}`);
    }
    assert.equal(
      refusal(
        Capabilities.allScopes.filter((s) => s !== needed),
        tag,
      )?.scope,
      needed,
      `${tag} with every other scope`,
    );
    assert.equal(refusal([needed], tag), undefined, tag);
  }
});

it('each device command is refused below its own scope', () => {
  // A `thread-action` needs its action's scope (`THREAD_ACTION_SCOPES`, relay.test.ts); with none it is `local`.
  for (const [type, needed] of Object.entries(Relay.COMMAND_SCOPES).filter(
    ([type]) => type !== 'thread-action',
  )) {
    const payload = { command: { type } };
    for (const held of Capabilities.allScopes.filter((s) => s !== needed))
      assert.equal(
        refusal([held], 'device.command', payload)?.scope,
        needed,
        `${type} with ${held}`,
      );
    assert.equal(refusal([needed], 'device.command', payload), undefined);
  }
  assert.equal(
    refusal(DEVICE, 'device.command', { command: { type: 'nope' } })?.scope,
    'local',
  );
});

it('every `local` RPC is refused to a device holding every scope it can', () => {
  const local = RPC_TAGS.filter((tag) => scopeOf(tag) === 'local');
  assert.ok(local.length > 200, `only ${local.length} local tags`);
  for (const tag of local)
    assert.ok(refusal(DEVICE, tag) instanceof Unauthorized, tag);
});

// A change here opens or closes an RPC to devices: review it as a security change.
it('what a device may call directly, by scope', () => {
  const open: Record<string, string[]> = {};
  for (const tag of RPC_TAGS) {
    const scope = scopeOf(tag);
    if (scope !== 'local') (open[scope] ??= []).push(tag);
  }
  for (const tags of Object.values(open)) tags.sort();
  assert.deepEqual(open, {
    read: [
      'agent.contextUsage',
      'agent.models',
      'backend.info',
      'backend.watch',
      'ping',
      'replica',
      'shell',
      'thread',
    ],
    operate: [
      'agent.compact',
      'agent.compactInstructions',
      'agent.interrupt',
      'agent.resolve',
      'agent.rewindFiles',
      'agent.setupChoice',
      'agent.stop',
      'agent.stopTask',
      'agent.unsteer',
    ],
    manage: [
      'agent.keepTitle',
      'agent.settle',
      'schedule.remove',
      'schedule.runNow',
      'schedule.setPaused',
    ],
    code: ['agent.attached', 'agent.rewindPoint'],
    terminal: ['terminal.output'],
  });
});

it('a command the adapter runs as an RPC needs that RPC’s scope', () => {
  const commands: Relay.RemoteCommand[] = [
    { type: 'setup-choice', threadId: 't', choice: 'retry' },
    ...(['run', 'pause', 'resume', 'remove'] as const).map(
      (action): Relay.RemoteCommand => ({
        type: 'schedule',
        threadId: 't',
        action,
      }),
    ),
  ];
  for (const command of commands) {
    const direct = directCall(command)!;
    assert.equal(
      scopeOf(direct.tag),
      Relay.commandScope(command),
      command.type,
    );
  }
});

it('a replica snapshot without `code` has no diffs, and no device gets the context', () => {
  const snapshot = {
    _tag: 'snapshot' as const,
    sequence: 4,
    saved: {
      threads: [{ id: 't1', activity: [{ text: 'edit', patch: 'diff' }] }],
      checkpoints: { t1: [{ n: 1 }] },
      remoteSideChats: { t1: { quote: 'diff' } },
      queue: [],
    },
    context: { profiles: [{ dir: '/Users/me/.claude' }] },
  };
  assert.deepEqual(visibleSnapshot(snapshot, ['read']), {
    ...snapshot,
    context: null,
    parts: 0,
    saved: {
      threads: [{ id: 't1', activity: [{ text: 'edit' }] }],
      checkpoints: {},
      queue: [],
    },
  });
  assert.deepEqual(visibleSnapshot(snapshot, DEVICE), {
    ...snapshot,
    context: null,
  });
  assert.deepEqual(visibleSnapshot(snapshot, Capabilities.allScopes), snapshot);
});

const startCore = Effect.gen(function* () {
  const context = yield* Layer.build(
    layerCore({
      port: 0,
      tokens: new Map([[TOKEN, Capabilities.allScopes]]),
      origins: [],
    }),
  );
  return (
    Context.get(context, HttpServer.HttpServer).address as { port: number }
  ).port;
});

const deviceOn = (port: number, scopes: ReadonlyArray<Relay.Scope>) =>
  makeCoreClient(
    coreUrl(port, mintDeviceToken(TOKEN, { id: 'd1', name: 'Laptop', scopes })),
  );

/** `host.*` tags are strings on the client (`HostRpcs`), so a call by tag. */
const host = (client: Effect.Success<ReturnType<typeof deviceOn>>) =>
  client as unknown as Record<
    string,
    (args: unknown) => Effect.Effect<unknown, unknown>
  >;

const create = (n: number) => ({
  type: COMMAND_TYPE,
  payload: {
    type: 'create',
    spaceId: 's',
    title: `Thread ${n}`,
    provider: 'claude',
    project: null,
    isLive: true,
  },
  commandId: `c${n}`,
});

it.live(
  'a device without `code` follows the replica by snapshots, never its events',
  () =>
    Effect.gen(function* () {
      const port = yield* startCore;
      const local = yield* makeCoreClient(coreUrl(port, TOKEN));
      yield* local['events.append'](create(1));

      const follow = (scopes: ReadonlyArray<Relay.Scope>) =>
        Effect.gen(function* () {
          const device = yield* deviceOn(port, scopes);
          const subscribed = yield* Deferred.make<void>();
          const items = yield* device.replica({ afterSequence: 0 }).pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            // With `code` the snapshot's checkpoints follow it as parts.
            Stream.filter((item) => item._tag !== 'checkpoints'),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild({ startImmediately: true }),
          );
          yield* Deferred.await(subscribed);
          return items;
        });
      const reader = yield* follow(['read']);
      const coder = yield* follow(['read', 'code']);
      yield* local['events.append'](create(2));

      const [first, next] = yield* Fiber.join(reader);
      assert.equal(first?._tag, 'snapshot');
      assert.equal(first?._tag === 'snapshot' && first.context, null);
      assert.equal(next?._tag, 'snapshot');
      const saved = (
        next as { saved: { threads: unknown[]; checkpoints: object } }
      ).saved;
      assert.equal(saved.threads.length, 2);
      assert.deepEqual(saved.checkpoints, {});

      const [, event] = yield* Fiber.join(coder);
      assert.equal(event?._tag, 'event');
    }),
);

it.live('a device’s scopes hold over its own socket', () =>
  Effect.gen(function* () {
    const port = yield* startCore;
    const reader = yield* deviceOn(port, ['read']);
    assert.equal(yield* reader.ping(), 'pong');
    const operate = yield* host(reader)['agent.interrupt']!(['t']).pipe(
      Effect.exit,
    );
    assert.equal(
      Exit.isFailure(operate) &&
        (Cause.squash(operate.cause) as Unauthorized).scope,
      'operate',
    );
    const everything = yield* deviceOn(port, DEVICE);
    for (const call of [
      everything.run({ command: 'true', args: [] }),
      everything['events.append'](create(9)),
      host(everything)['fs.read']!(['/', 'etc/hosts']),
    ]) {
      const exit = yield* Effect.exit(call);
      assert.equal(
        Exit.isFailure(exit) &&
          (Cause.squash(exit.cause) as Unauthorized).scope,
        'local',
      );
    }
  }),
);

it.live('device.command and the RPC it adapts answer alike', () =>
  Effect.gen(function* () {
    const port = yield* startCore;
    const local = yield* makeCoreClient(coreUrl(port, TOKEN));
    yield* local['events.append'](create(1));
    const device = yield* deviceOn(port, DEVICE);

    const command = {
      type: 'setup-choice',
      threadId: 'new-1',
      choice: 'skip',
    } as const;
    const adapted = yield* device['device.command']({ command });
    const direct = yield* host(device)['agent.setupChoice']!([
      'new-1',
      'skip',
    ]).pipe(Effect.exit);
    assert.deepEqual(
      adapted,
      Exit.isSuccess(direct)
        ? { isOk: true }
        : { isOk: false, error: Cause.squash(direct.cause) },
    );
    assert.equal(adapted.isOk, false, 'no setup was waiting');

    assert.deepEqual(
      yield* device['device.command']({
        command: { type: 'schedule', threadId: 'new-1', action: 'run' },
      }),
      { isOk: false, error: 'This thread has no schedule' },
    );
    assert.deepEqual(
      yield* device['device.command']({
        command: { ...command, threadId: 'gone' },
      }),
      { isOk: false, error: 'No such thread on this machine' },
    );
  }),
);
