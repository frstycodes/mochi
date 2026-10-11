import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampOffset, swipeStep } from './usePagedSwipe.ts';

test('a swipe never travels past the neighbouring page, however long it runs', () => {
  assert.equal(clampOffset(5000, 300), 300);
  assert.equal(clampOffset(-5000, 300), -300);
  assert.equal(clampOffset(120, 300), 120);
});

test('a third of a page or a projected flick moves one page; less settles back', () => {
  assert.equal(swipeStep(100, 0, 300), 1);
  assert.equal(swipeStep(-100, 0, 300), -1);
  assert.equal(swipeStep(40, 0, 300), null);
  assert.equal(swipeStep(40, 8, 300), 1);
  assert.equal(swipeStep(300, -40, 300), -1);
});
