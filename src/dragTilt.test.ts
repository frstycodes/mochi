import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tiltFor } from './dragTilt.ts';

test('tilt leans away from the grab point and is level at the centre', () => {
  assert.equal(tiltFor(0, 200), 4);
  assert.equal(tiltFor(200, 200), -4);
  assert.equal(tiltFor(100, 200), 0);
  assert.equal(tiltFor(50, 200), 2);
  assert.equal(tiltFor(-30, 200), 4);
  assert.equal(tiltFor(10, 0), 0);
});
