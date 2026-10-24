import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { nearestPage } from './useSnapPager.ts';

test('a swipe ticks once per page crossed, both ways, and a programmatic move never ticks', () => {
  const nearest = nearestPage(0);
  const ticks = [0, 0, 1, 1, 1, 2, 2, 1, 0, 0].filter((page) => nearest.cross(page)).length;
  assert.equal(ticks, 4);
  nearest.set(2);
  assert.equal(nearest.cross(2), false, 'the scroll events of a key or click move');
});
