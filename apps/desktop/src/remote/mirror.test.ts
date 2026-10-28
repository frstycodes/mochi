import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { MirrorFrame } from '../host/types/remote.ts';
import type { Action } from '../store/index.tsx';
import { mirrorState, reducer } from '../store/root.ts';
import { splitSaved, toSaved } from '../store/saved.ts';
import {
  applyFrame,
  cachedMirror,
  remoteDecisions,
  type Mirror,
} from './mirror.ts';
import type { FollowedView } from './useMachines.tsx';
import { findAnyThread } from '../store/anyThread.ts';
import { parseRemoteThreadId, remoteThreadId, toWire, wireId } from './ids.ts';

/** A machine's store with one live thread; each thread file as its `thread` stream sends it after a save. */
function machine() {
  let state = reducer(
    mirrorState({
      version: 1,
      now: 900,
      seq: 1,
      threads: [],
      queue: [],
      checkpoints: {},
      checkpointSeq: 0,
      forks: {},
    }),
    {
      type: 'create',
      title: 'Fix login',
      provider: 'claude',
      project: null,
      isLive: true,
      isBackground: true,
    },
  );
  const files = () =>
    Object.entries(splitSaved(toSaved(state)).threads).map(
      ([threadId, json]): MirrorFrame => ({
        type: 'thread',
        threadId,
        saved: JSON.parse(json),
      }),
    );
  const act = (action: Action) => {
    state = reducer(state, action);
    return files();
  };
  return {
    act,
    files,
    threadId: () => state.threads[0].id,
    state: () => state,
  };
}

const apply = (
  mirror: Mirror | undefined,
  frames: MirrorFrame[],
  machineId = 'mac',
) =>
  frames.reduce<Mirror | undefined>(
    (m, frame) => applyFrame(machineId, m, frame),
    mirror,
  );

test('a mirror built from the thread files matches the machine’s threads', () => {
  const m = machine();
  let mirror = apply(undefined, m.files());
  const threadId = m.threadId();
  for (const action of [
    { type: 'rename', threadId, title: 'Fix SSO login' },
    {
      type: 'say',
      threadId,
      entry: { who: 'harness', kind: 'event', text: 'Hello' },
    },
  ] as Action[])
    mirror = apply(mirror, m.act(action));
  // Through JSON, as the stream carries it: only undefined fields differ, and every thread id is machine-aware.
  const [thread] = m.state().threads;
  assert.deepEqual(mirror?.state.threads, [
    {
      ...JSON.parse(JSON.stringify(thread)),
      id: remoteThreadId('mac', threadId),
    },
  ]);
});

test('a deleted thread leaves the mirror, and a reset empties it', () => {
  const m = machine();
  const threadId = m.threadId();
  const mirror = apply(undefined, m.files());
  assert.equal(
    applyFrame('mac', mirror, { type: 'thread', threadId, saved: null }).state
      .threads.length,
    0,
  );
  assert.deepEqual(applyFrame('mac', mirror, { type: 'reset' }).threads, {});
});

test('two machines’ colliding thread ids stay apart, and the files keep their own ids', () => {
  const [a, b] = [machine(), machine()];
  assert.equal(a.threadId(), b.threadId());
  const id = a.threadId();
  const mirrors = {
    mac: apply(undefined, a.files(), 'mac'),
    pc: apply(undefined, b.files(), 'pc'),
  };
  const ids = Object.values(mirrors).flatMap((m) =>
    m!.state.threads.map((t) => t.id),
  );
  assert.deepEqual(ids, ['mac~' + id, 'pc~' + id]);
  // What the cache stores: the machine's own ids, prefixed again when read back.
  assert.deepEqual(Object.keys(mirrors.mac!.threads), [id]);
  assert.equal(mirrors.mac!.threads[id].thread.id, id);
  assert.deepEqual(
    cachedMirror(
      'mac',
      JSON.parse(JSON.stringify(mirrors.mac!.threads)),
    ).state.threads.map((t) => t.id),
    ['mac~' + id],
  );
});

test('every thread reference in a mirrored file is machine-aware', () => {
  const m = machine();
  const threadId = m.threadId();
  const [frame] = m.files();
  if (frame.type !== 'thread') throw new Error('expected a thread frame');
  const saved = frame.saved as { thread: Record<string, unknown> };
  const file = {
    ...saved,
    thread: {
      ...saved.thread,
      parent: { threadId: 'new-0', title: 'Parent' },
      replyTo: [{ threadId: 'new-0', title: 'Parent' }],
    },
    fork: { parentId: 'new-0', at: 0, label: 'Fork' },
    checkpoints: [],
  };
  const mirror = applyFrame('mac', undefined, { ...frame, saved: file });
  const [thread] = mirror.state.threads;
  assert.equal(thread.parent?.threadId, 'mac~new-0');
  assert.equal(thread.replyTo?.[0].threadId, 'mac~new-0');
  assert.deepEqual(Object.keys(mirror.state.checkpoints), [`mac~${threadId}`]);
  assert.equal(mirror.state.forks[`mac~${threadId}`].parentId, 'mac~new-0');
});

test('ids parse back to their machine, and commands go out with bare ids', () => {
  assert.deepEqual(parseRemoteThreadId('mac~new-1'), {
    machineId: 'mac',
    threadId: 'new-1',
  });
  assert.equal(parseRemoteThreadId('new-1'), null);
  assert.equal(wireId('new-1'), 'new-1');
  assert.deepEqual(
    toWire({ type: 'send', threadId: 'mac~new-1', text: 'hi' }),
    {
      type: 'send',
      threadId: 'new-1',
      text: 'hi',
    },
  );
  assert.deepEqual(toWire({ type: 'resolve', queueId: 'mac~q-3' }), {
    type: 'resolve',
    queueId: 'q-3',
  });
  assert.deepEqual(
    toWire({
      type: 'seen',
      threadId: 'mac~new-1',
      queueIds: ['mac~q-1', 'mac~q-2'],
    }),
    {
      type: 'seen',
      threadId: 'new-1',
      queueIds: ['q-1', 'q-2'],
    },
  );
  assert.deepEqual(toWire({ type: 'catalog' }), { type: 'catalog' });
});

test('any thread resolves to this computer’s or a followed machine’s', () => {
  const [a, b] = [machine(), machine()];
  const id = a.threadId();
  const state = apply(undefined, b.files(), 'pc')!.state;
  const pc = { id: 'pc', name: 'PC' } as FollowedView['machine'];
  const machines: FollowedView[] = [{ machine: pc, state }];
  const local = a.state().threads[0];
  assert.deepEqual(findAnyThread(local, machines, id), {
    thread: local,
    machine: null,
  });
  assert.deepEqual(findAnyThread(undefined, machines, `pc~${id}`), {
    thread: state.threads[0],
    machine: pc,
  });
  assert.equal(findAnyThread(undefined, machines, `mac~${id}`), undefined);
});

test('a thread’s open asks reach the mirror with machine-aware ids, and answering sends the machine’s own', () => {
  const m = machine();
  const threadId = m.threadId();
  const item = {
    id: 'q-7',
    kind: 'question' as const,
    threadId,
    title: 'Which database?',
    detail: '',
    blocks: { steps: 0, threads: 1 },
    createdAt: 1,
  };
  let mirror = apply(undefined, m.files());
  assert.deepEqual(mirror?.state.queue, []);
  mirror = apply(mirror, m.act({ type: 'queue-add', item }));
  const [ask] = remoteDecisions(mirror!.state);
  assert.equal(ask.id, remoteThreadId('mac', 'q-7'));
  assert.equal(ask.threadId, remoteThreadId('mac', threadId));
  assert.deepEqual(toWire({ type: 'resolve', queueId: ask.id }), {
    type: 'resolve',
    queueId: 'q-7',
  });
  // Another machine's identical ids stay apart.
  const other = apply(undefined, m.files(), 'pc');
  assert.equal(other?.state.queue[0].id, 'pc~q-7');
  // Answered there: the next save drops it here, and the cache round trip keeps it.
  const cached = cachedMirror(
    'mac',
    JSON.parse(JSON.stringify(mirror!.threads)),
  );
  assert.equal(cached.state.queue[0].id, 'mac~q-7');
  mirror = apply(mirror, m.act({ type: 'answer', queueId: 'q-7' }));
  assert.deepEqual(mirror?.state.queue, []);
});
