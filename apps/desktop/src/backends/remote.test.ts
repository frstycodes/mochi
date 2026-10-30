import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { COMMAND_TYPE, type ReplicaItem } from '@mochi/domain';
import type { MirrorFrame } from '../host/types/remote.ts';
import { parseRemoteThreadId } from '../remote/ids.ts';
import { applyFrame, type Mirror } from '../remote/mirror.ts';
import type { Action, State } from '../store/types.ts';
import { createReplica, type ReplicaLog } from '../store/replica.ts';
import { mirrorState, reducer } from '../store/root.ts';
import { splitSaved, toSaved } from '../store/saved.ts';
import type { ChannelReply, ChannelRequest } from './channel.ts';
import { createBackends } from './registry.ts';
import { connectRemote, remoteView } from './remote.ts';

const EMPTY = {
  version: 1 as const,
  now: 900,
  seq: 1,
  threads: [],
  queue: [],
  checkpoints: {},
  checkpointSeq: 0,
  forks: {},
};

/** Another computer's store, its `replica` log, and the thread files its `thread` streams send the mirror. */
function machine() {
  let state: State = mirrorState(EMPTY);
  let sequence = 0;
  const followers = new Set<(item: ReplicaItem) => void>();
  const act = (action: Action) => {
    state = reducer(state, action, { ms: 1000 + sequence });
    const item: ReplicaItem = {
      _tag: 'event',
      event: {
        sequence: ++sequence,
        at: 1000 + sequence,
        type: COMMAND_TYPE,
        threadId: 'threadId' in action ? (action.threadId as string) : null,
        payload: action,
        commandId: `other:${sequence}`,
      },
    };
    followers.forEach((f) => f(item));
  };
  const log: ReplicaLog = {
    follow(_after, onItem) {
      followers.add(onItem);
      // Through JSON, as the channel carries it.
      onItem(
        JSON.parse(
          JSON.stringify({
            _tag: 'snapshot',
            sequence,
            saved: toSaved(state),
            context: null,
          }),
        ) as ReplicaItem,
      );
      return () => void followers.delete(onItem);
    },
    append: () => Promise.reject(new Error('read only')),
  };
  const frames = (): MirrorFrame[] =>
    Object.entries(splitSaved(toSaved(state)).threads).map(
      ([threadId, json]) => ({
        type: 'thread',
        threadId,
        saved: JSON.parse(json),
      }),
    );
  return { act, log, frames, state: () => state };
}

const mirrored = (mirror: Mirror | undefined, frames: MirrorFrame[]) =>
  frames.reduce<Mirror | undefined>((m, f) => applyFrame('mini', m, f), mirror);

/** What the merged views read from either path: threads and Queue, through JSON so only undefined fields don't count. */
const shape = (state: State) =>
  JSON.parse(
    JSON.stringify({
      threads: state.threads,
      queue: state.queue,
      forks: state.forks,
    }),
  );

test('a remote backend’s replica matches the mirror of the same computer', async () => {
  const m = machine();
  m.act({
    type: 'create',
    title: 'Fix login',
    provider: 'claude',
    project: null,
    isLive: true,
    isBackground: true,
  } as Action);
  const replica = await createReplica(
    m.log,
    (saved) => mirrorState(saved ?? EMPTY),
    (run) => {
      run();
      return () => {};
    },
  );
  let mirror = mirrored(undefined, m.frames());
  assert.deepEqual(
    shape(remoteView('mini', replica.getState())),
    shape(mirror!.state),
  );

  const threadId = m.state().threads[0]!.id;
  for (const action of [
    { type: 'rename', threadId, title: 'Fix SSO login' },
    {
      type: 'say',
      threadId,
      entry: { who: 'harness', kind: 'event', text: 'Hello' },
    },
    {
      type: 'create',
      title: 'Second',
      provider: 'claude',
      project: null,
      isLive: true,
      isBackground: true,
    },
  ] as Action[]) {
    m.act(action);
    mirror = mirrored(mirror, m.frames());
  }
  const view = remoteView('mini', replica.getState());
  assert.equal(view.threads.length, 2);
  assert.ok(
    view.threads.every((t) => parseRemoteThreadId(t.id)?.machineId === 'mini'),
  );
  assert.deepEqual(shape(view), shape(mirror!.state));
  assert.equal(
    remoteView('mini', replica.getState()),
    view,
    'unchanged state, same view',
  );
  replica.stop();
});

/** Main's end of a channel: answers `replica` from the machine's log and `backend.watch` once; `closed` when told. */
function mainEnd(port: MessagePort, log: ReplicaLog) {
  port.onmessage = ({ data }: MessageEvent<ChannelRequest>) => {
    if ('cancel' in data) return;
    const reply = (r: ChannelReply) => port.postMessage(r);
    if (data.tag === 'replica')
      log.follow(
        0,
        (item) => reply({ id: data.id, item }),
        () => reply({ id: data.id, end: true }),
      );
    if (data.tag === 'backend.watch')
      reply({
        id: data.id,
        item: {
          id: 'mini',
          name: 'Mac mini',
          kind: 'mac',
          appVersion: '1',
          protocolVersion: 8,
          capabilities: [],
          scopes: ['read'],
        },
      });
  };
  return {
    close: () => port.postMessage({ closed: true } satisfies ChannelReply),
  };
}

const until = (
  registry: ReturnType<typeof createBackends>,
  check: () => boolean,
) =>
  new Promise<void>((resolve) => {
    if (check()) return resolve();
    const stop = registry.subscribe(() => check() && (stop(), resolve()));
  });

test('a channel from main adds its computer once its replica is in, and closing it removes it', async () => {
  const m = machine();
  m.act({
    type: 'create',
    title: 'Fix login',
    provider: 'claude',
    project: null,
    isLive: true,
    isBackground: true,
  } as Action);
  const registry = createBackends();
  const { port1, port2 } = new MessageChannel();
  const main = mainEnd(port1, m.log);
  connectRemote(registry, 'mini', port2);
  await until(
    registry,
    () => registry.get('mini')?.descriptor?.name === 'Mac mini',
  );
  const backend = registry.get('mini')!;
  assert.equal(backend.isLocal, false);
  assert.equal(backend.transport.kind, 'device');
  assert.equal(backend.replica.getState().threads[0]?.title, 'Fix login');
  const unanswered = backend.call('events.append', {});

  main.close();
  await until(registry, () => registry.list().length === 0);
  await assert.rejects(unanswered, /went offline/);
  await assert.rejects(backend.call('ping'), /went offline/);
  port1.close();
}, 5000);
