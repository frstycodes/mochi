import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isCommit } from './RowSwipe.tsx';

test('a slow drag acts only past the commit distance, either way', () => {
  assert.equal(isCommit(80, 0.2), false);
  assert.equal(isCommit(96, 0.2), true);
  assert.equal(isCommit(-96, 0.2), true);
});

test('a flick acts from a shorter drag, but never from a nudge', () => {
  assert.equal(isCommit(40, 0.8), true);
  assert.equal(isCommit(-40, 0.8), true);
  assert.equal(isCommit(20, 2), false);
  assert.equal(isCommit(40, 0.3), false);
});
