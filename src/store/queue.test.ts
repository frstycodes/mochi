import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { State } from './index.tsx';
import { initialQueue, queueReducer } from './queue.ts';
import { initialThreads } from './threads.ts';

test('Mark done on a review settles the thread and never touches PR state', () => {
  const state = { ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} } as unknown as State;
  const before = state.threads.find((t) => t.id === 'auth')!;
  assert.ok(before.prs.some((p) => p.state === 'open'), 'fixture has an open PR');
  const s = queueReducer(state, { type: 'answer', queueId: 'q-review' });
  const auth = s.threads.find((t) => t.id === 'auth')!;
  assert.equal(auth.status, 'settled');
  assert.deepEqual(auth.prs, before.prs);
  assert.equal(auth.activity.at(-1)!.text, 'Marked done');
  assert.equal(s.queue.some((q) => q.id === 'q-review'), false);
});
