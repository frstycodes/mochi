import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { addPrompt, stepHistory } from './promptHistory';

test('a resent prompt moves to the newest and the list keeps its cap', () => {
  assert.deepEqual(addPrompt(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
  assert.deepEqual(addPrompt(['a', 'b', 'c'], 'd', 3), ['b', 'c', 'd']);
});

test('Up walks back to the oldest, Down walks forward to the draft', () => {
  assert.deepEqual(stepHistory(2, null, -1), { at: 0 });
  assert.deepEqual(stepHistory(2, 0, -1), { at: 1 });
  assert.equal(stepHistory(2, 1, -1), null);
  assert.deepEqual(stepHistory(2, 1, 1), { at: 0 });
  assert.deepEqual(stepHistory(2, 0, 1), { at: null });
  assert.equal(stepHistory(2, null, 1), null);
  assert.equal(stepHistory(0, null, -1), null);
});
