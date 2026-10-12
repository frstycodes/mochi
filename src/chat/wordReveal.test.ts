import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleStarts } from './wordReveal.ts';

const opts = { stagger: 30, minStagger: 6, maxBacklogMs: 900 };

test('words trickle in one stagger apart, after the last scheduled word', () => {
  assert.deepEqual(scheduleStarts(-Infinity, 1000, 3, opts), [1000, 1030, 1060]);
  assert.deepEqual(scheduleStarts(1050, 1000, 2, opts), [1080, 1110]);
});

test('a burst squeezes its stagger so no word starts past the backlog cap', () => {
  const starts = scheduleStarts(-Infinity, 0, 101, opts);
  assert.equal(starts.at(-1), 900);
  assert.equal(starts[1] - starts[0], 9);
});

test('a backlog past the cap falls back to the minimum stagger, never zero', () => {
  const starts = scheduleStarts(2000, 0, 3, opts);
  assert.deepEqual(starts, [2030, 2036, 2042]);
});
