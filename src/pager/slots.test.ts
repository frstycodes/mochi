import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  OFF_PIN,
  clampToNeighbours,
  isHot,
  pagerSlots,
  pinnedNeighbour,
  releasePage,
  swipeStarts,
} from './slots.ts';

const PINS = ['a', 'b', 'c', 'd', 'e'];

test('pins keep pin order and the focused one sits at its own position', () => {
  assert.deepEqual(pagerSlots(PINS, ['c'], 'c'), { ids: PINS, center: 2 });
});

test('other threads in the focused split group leave the pager', () => {
  assert.deepEqual(pagerSlots(PINS, ['c', 'a', 'x'], 'c'), {
    ids: ['b', 'c', 'd', 'e'],
    center: 1,
  });
});

test('an unpinned view sits before the first pin', () => {
  assert.deepEqual(pagerSlots(PINS, ['x'], 'x'), {
    ids: [OFF_PIN, ...PINS],
    center: 0,
  });
  assert.deepEqual(pagerSlots(PINS, [], undefined), {
    ids: [OFF_PIN, ...PINS],
    center: 0,
  });
});

test('neighbours are pins only; the ends have none', () => {
  assert.equal(pinnedNeighbour({ ids: PINS, center: 2 }, 1), 'd');
  assert.equal(pinnedNeighbour({ ids: PINS, center: 0 }, -1), undefined);
  assert.equal(
    pinnedNeighbour({ ids: [OFF_PIN, ...PINS], center: 1 }, -1),
    undefined,
  );
});

test('the current page and one each side stay mounted', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].filter((p) => isHot(p, 2)),
    [1, 2, 3],
  );
});

test('a drag release turns one page on a flick or past half, else springs back', () => {
  assert.equal(releasePage(2, 100, 1000, 0, 5), 2);
  assert.equal(releasePage(2, 600, 1000, 0, 5), 3);
  assert.equal(releasePage(2, -600, 1000, 0, 5), 1);
  assert.equal(releasePage(2, 80, 1000, 0.8, 5), 3);
  assert.equal(releasePage(2, -80, 1000, -0.8, 5), 1);
  assert.equal(releasePage(2, 1900, 1000, 3, 5), 3);
});

test('a release never leaves the pages', () => {
  assert.equal(releasePage(0, -600, 1000, -1, 5), 0);
  assert.equal(releasePage(4, 600, 1000, 1, 5), 4);
});

test('a swipe is held within one page of where it started', () => {
  assert.equal(clampToNeighbours(2600, 0, 1000), 1000);
  assert.equal(clampToNeighbours(-300, 2, 1000), 1000);
  assert.equal(clampToNeighbours(2400, 2, 1000), 2400);
  assert.equal(clampToNeighbours(3700, 2, 1000), 3000);
});

/** Feeds horizontal deltas 16ms apart (after `startAt`) and returns the indices that started a swipe. */
function starts(deltas: number[], startAt = 0) {
  const isStart = swipeStarts(400);
  return deltas.flatMap((dx, i) =>
    isStart(startAt + i * 16, dx, 0) ? [i] : [],
  );
}

test('a swipe and its momentum are one swipe', () => {
  const fingers = [4, 12, 30, 48, 52, 47, 53, 49];
  const momentum = [44, 38, 31, 25, 19, 14, 10, 7, 4, 2, 1, 1];
  assert.deepEqual(starts([...fingers, ...momentum]), [0]);
});

test('new fingers during momentum start a second swipe with no gap', () => {
  const momentum = [44, 38, 31, 25, 19];
  assert.deepEqual(starts([20, 45, 50, ...momentum, 6, 18, 40]), [0, 9]);
});

test('a pile-up behind a busy frame stays the same swipe; a gentle start after a pause is a new one', () => {
  const isStart = swipeStarts(400);
  assert.equal(isStart(0, 20, 0), true);
  assert.equal(isStart(16, 50, 0), false);
  assert.equal(isStart(200, 434, 0), false);
  assert.equal(isStart(216, 50, 0), false);
  assert.equal(isStart(400, 10, 0), true);
  assert.equal(isStart(1000, 120, 0), true);
});
