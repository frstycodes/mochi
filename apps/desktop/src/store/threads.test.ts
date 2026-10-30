import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import type { State } from './index.tsx';
import { threadsReducer } from './threads.ts';

test('a streamed token changes the transcript and leaves the plan as it was', () => {
  const t = {
    id: 't',
    status: 'running',
    providers: ['claude'],
    steps: [{ id: 's1', title: 'Plan', status: 'running' }],
    activity: [{ at: 1, who: 'claude', kind: 'message', text: 'Hel' }],
    prs: [],
  } as unknown as Thread;
  const state = {
    now: 1,
    threads: [t],
    queue: [],
    checkpoints: { t: [] },
    checkpointSeq: 0,
  } as unknown as State;
  const [after] = threadsReducer(state, {
    type: 'agent',
    event: { threadId: 't', type: 'message', text: 'lo', isDelta: true },
    ms: 5,
  }).threads;
  assert.equal(after.activity[0].text, 'Hello');
  assert.equal(after.steps, t.steps);
});
