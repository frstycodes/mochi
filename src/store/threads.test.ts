import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '../model.ts';
import type { State } from './index.tsx';
import { threadsReducer } from './threads.ts';

test("a turn's late update is dropped once the next turn has ended", () => {
  const t = { id: 't', status: 'running', steps: [], activity: [], prs: [] } as unknown as Thread;
  const at = (s: Thread) => ({ now: 1, threads: [s], checkpoints: { t: [] }, checkpointSeq: 0 }) as unknown as State;
  const [first] = threadsReducer(at(t), { type: 'idle-start', threadId: 't' }).threads;
  const [second] = threadsReducer(at(first), { type: 'idle-start', threadId: 't' }).threads;
  const [late] = threadsReducer(at(second), { type: 'idle-update', threadId: 't', patch: { uncommitted: 1 }, turn: 1 }).threads;
  assert.equal(late.idle?.uncommitted, undefined);
  const [current] = threadsReducer(at(second), { type: 'idle-update', threadId: 't', patch: { uncommitted: 2 }, turn: 2 }).threads;
  assert.equal(current.idle?.uncommitted, 2);
});
