import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { stepThread } from './threadSwitch.ts';

const ids = ['a', 'b', 'c'];

test('steps through the list and wraps at both ends', () => {
  assert.equal(stepThread(ids, 'a', 1), 'b');
  assert.equal(stepThread(ids, 'c', 1), 'a');
  assert.equal(stepThread(ids, 'a', -1), 'c');
  assert.equal(stepThread(ids, 'b', -1), 'a');
});

test('from no listed thread, next is the first and previous the last', () => {
  assert.equal(stepThread(ids, undefined, 1), 'a');
  assert.equal(stepThread(ids, 'gone', -1), 'c');
  assert.equal(stepThread([], 'a', 1), undefined);
});
