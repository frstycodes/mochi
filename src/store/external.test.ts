import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExternalState } from './external.ts';

test('deferred changes apply at once and notify once on the next frame; a set notifies now and drops the pending frame', () => {
  const frames: (() => void)[] = [];
  const store = createExternalState(0, (run) => (frames.push(run), () => void frames.splice(frames.indexOf(run), 1)));
  let calls = 0;
  store.subscribe(() => calls++);
  store.defer(1);
  store.defer(2);
  assert.equal(store.getState(), 2);
  assert.equal(calls, 0);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(calls, 1);
  store.defer(3);
  store.set(4);
  assert.equal(calls, 2);
  assert.equal(frames.length, 0);
  store.defer(5);
  store.set(5);
  assert.equal(calls, 3, 'a set of the same state still delivers the deferred change');
});
