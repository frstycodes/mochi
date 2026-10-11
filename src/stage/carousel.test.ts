import assert from 'node:assert/strict';
import test from 'node:test';
import { CENTER, cardPose, needsYouNearCenter, stackCount, stageSlots } from './carousel.ts';

const PINS = ['a', 'b', 'c', 'd', 'e'];

test('pins before the focused one sit left of it, after it right: position = pin order', () => {
  assert.deepEqual(stageSlots(PINS, ['c'], 'c'), { ids: PINS, center: 2 });
});

test('other threads in the center split group leave the edges', () => {
  assert.deepEqual(stageSlots(PINS, ['c', 'a', 'x'], 'c'), { ids: ['b', 'c', 'd', 'e'], center: 1 });
});

test('an unpinned center sits before the first pin', () => {
  assert.deepEqual(stageSlots(PINS, ['x'], 'x'), { ids: [CENTER, ...PINS], center: 0 });
  assert.deepEqual(stageSlots(PINS, [], undefined), { ids: [CENTER, ...PINS], center: 0 });
});

test('needs-you threads move nearest the center on their own side only', () => {
  const urgent = new Set(['a', 'e']);
  assert.deepEqual(needsYouNearCenter({ ids: PINS, center: 2 }, (id) => urgent.has(id)), { ids: ['b', 'a', 'c', 'e', 'd'], center: 2 });
});

test('nearer cards are larger and stick out further; the deck recedes', () => {
  const [near, mid, far] = [1, 2, 3].map((d) => cardPose(d, false));
  assert.ok(near.scale > mid.scale && mid.scale > far.scale);
  assert.ok(near.inset > mid.inset && mid.inset > far.inset);
  assert.ok(near.z > mid.z && mid.z > far.z);
  assert.equal(near.inset, 36);
});

test('cards past the third share its pose and fade out', () => {
  const third = cardPose(3, false);
  const fourth = cardPose(4, false);
  assert.equal(fourth.inset, third.inset);
  assert.equal(fourth.opacity, 0);
  assert.equal(cardPose(3.5, false).opacity, 0.5);
});

test('a card crossing to the center travels inward and hands over to the live view', () => {
  assert.ok(cardPose(0.5, false).inset > cardPose(1, false).inset);
  assert.equal(cardPose(0, false).opacity, 0);
  assert.equal(cardPose(-1, false).inset, cardPose(1, false).inset);
});

test('reduced motion: flat cards', () => {
  const pose = cardPose(2, true);
  assert.equal(pose.rotate, 0);
  assert.equal(pose.scale, 1);
  assert.equal(pose.depth, 0);
});

test('only the last visible card of a deck deeper than three carries a count', () => {
  const slots = { ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], center: 0 };
  assert.equal(stackCount(3, slots), 4);
  assert.equal(stackCount(2, slots), null);
  assert.equal(stackCount(3, { ids: ['a', 'b', 'c', 'd'], center: 0 }), null);
});
