import assert from 'node:assert/strict';
import test from 'node:test';
import { threadSessions } from './settle.ts';

test("settling a thread takes its own session and its background agents, never another thread's", () => {
  const live = ['t-1', 't-1--bg1', 't-1--bg2', 't-10', 't-10--bg1', 't-2', 't-1', 'review-3'];
  assert.deepEqual(threadSessions('t-1', live), ['t-1', 't-1--bg1', 't-1--bg2']);
  assert.deepEqual(threadSessions('t-3', live), []);
});
