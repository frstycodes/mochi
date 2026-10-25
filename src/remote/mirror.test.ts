import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { MirrorFrame } from '../host/types/remote.ts';
import type { Action } from '../store/index.tsx';
import { mirrorState, reducer } from '../store/root.ts';
import { splitSaved, toSaved } from '../store/saved.ts';
import { applyFrame, type Mirror } from './mirror.ts';

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

const apply = (mirror: Mirror | undefined, frames: MirrorFrame[]) =>
  frames.reduce<Mirror | undefined>(applyFrame, mirror);

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
  // Through JSON, as the stream carries it: only undefined fields differ.
  assert.deepEqual(
    mirror?.state.threads,
    JSON.parse(JSON.stringify(m.state().threads)),
  );
});

test('a deleted thread leaves the mirror, and a reset empties it', () => {
  const m = machine();
  const threadId = m.threadId();
  const mirror = apply(undefined, m.files());
  assert.equal(
    applyFrame(mirror, { type: 'thread', threadId, saved: null }).state.threads
      .length,
    0,
  );
  assert.deepEqual(applyFrame(mirror, { type: 'reset' }).threads, {});
});
