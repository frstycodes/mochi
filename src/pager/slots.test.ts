import assert from 'node:assert/strict';
import test from 'node:test';
import { OFF_PIN, isHot, pagerSlots, pinnedNeighbour, releasePage } from './slots.ts';

const PINS = ['a', 'b', 'c', 'd', 'e'];

test('pins keep pin order and the focused one sits at its own position', () => {
  assert.deepEqual(pagerSlots(PINS, ['c'], 'c'), { ids: PINS, center: 2 });
});

test('other threads in the focused split group leave the pager', () => {
  assert.deepEqual(pagerSlots(PINS, ['c', 'a', 'x'], 'c'), { ids: ['b', 'c', 'd', 'e'], center: 1 });
});

test('an unpinned view sits before the first pin', () => {
  assert.deepEqual(pagerSlots(PINS, ['x'], 'x'), { ids: [OFF_PIN, ...PINS], center: 0 });
  assert.deepEqual(pagerSlots(PINS, [], undefined), { ids: [OFF_PIN, ...PINS], center: 0 });
});

test('neighbours are pins only; the ends have none', () => {
  assert.equal(pinnedNeighbour({ ids: PINS, center: 2 }, 1), 'd');
  assert.equal(pinnedNeighbour({ ids: PINS, center: 0 }, -1), undefined);
  assert.equal(pinnedNeighbour({ ids: [OFF_PIN, ...PINS], center: 1 }, -1), undefined);
});

test('the current page and one each side stay mounted', () => {
  assert.deepEqual([0, 1, 2, 3, 4].filter((p) => isHot(p, 2)), [1, 2, 3]);
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
