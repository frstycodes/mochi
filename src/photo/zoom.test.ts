import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIT, MAX_SCALE, clampPan, isBackdropClick, zoomAt } from './zoom.ts';

const fitted = { width: 800, height: 600 };
const viewport = { width: 1000, height: 700 };

test('zooming keeps the point under the cursor still', () => {
  const at = { x: 200, y: 100 };
  const v = zoomAt(FIT, 2, at, fitted, viewport);
  // The image point under the cursor was (at - offset) / scale = (200, 100); after zooming it must map back to the cursor.
  assert.equal(v.x + 200 * v.scale, at.x);
  assert.equal(v.y + 100 * v.scale, at.y);
  assert.equal(v.scale, 2);
});

test('zoom stops at fit and at the maximum', () => {
  assert.deepEqual(zoomAt({ scale: 1.5, x: 40, y: 10 }, 0.1, { x: 0, y: 0 }, fitted, viewport), FIT);
  assert.equal(zoomAt(FIT, 100, { x: 0, y: 0 }, fitted, viewport).scale, MAX_SCALE);
});

test('panning stops at the image edges and keeps a narrow axis centred', () => {
  const v = clampPan({ scale: 2, x: 5000, y: 5000 }, fitted, viewport);
  assert.equal(v.x, (800 * 2 - 1000) / 2);
  assert.equal(v.y, (600 * 2 - 700) / 2);
  assert.equal(clampPan({ scale: 1.1, x: 0, y: 300 }, fitted, viewport).y, 0);
});

test('a click closes only outside the image and only when it did not end a pan', () => {
  const image = { left: 100, top: 50, right: 900, bottom: 650 };
  const click = (x: number, y: number, press = { x, y }) => isBackdropClick({ x, y }, press, image);
  assert.equal(click(50, 300), true);
  assert.equal(click(500, 20), true);
  assert.equal(click(500, 300), false);
  assert.equal(click(100, 50), false);
  assert.equal(click(50, 300, { x: 60, y: 300 }), false);
  assert.equal(isBackdropClick({ x: 500, y: 300 }, { x: 500, y: 300 }, undefined), true);
});
