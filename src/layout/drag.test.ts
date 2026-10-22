import assert from 'node:assert/strict';
import { test } from 'node:test';
import { middleHalf } from './drag.ts';

// A 40px-tall row at y 100–140, x 0–200: its middle half is y 110–130.
const hit = (x: number, y: number) => {
  const droppable = { id: 'row', element: { getBoundingClientRect: () => ({ left: 0, right: 200, top: 100, bottom: 140, height: 40 }) } };
  return middleHalf({ droppable, dragOperation: { position: { current: { x, y } } } } as unknown as Parameters<typeof middleHalf>[0]);
};

test('nests only over the middle half of a row', () => {
  assert.equal(hit(50, 120)?.id, 'row');
  assert.equal(hit(50, 110)?.id, 'row');
  assert.equal(hit(50, 130)?.id, 'row');
  assert.equal(hit(50, 109), null);
  assert.equal(hit(50, 131), null);
});

test('never nests once the pointer leaves the row sideways, onto a split', () => {
  assert.equal(hit(201, 120), null);
  assert.equal(hit(-1, 120), null);
});
