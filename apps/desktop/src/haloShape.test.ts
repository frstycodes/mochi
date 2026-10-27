import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { haloAlpha, haloEdge } from './haloShape.ts';

const width = 64;
const height = 40;
const alpha = haloAlpha(width, height, 1234);
const at = (x: number, y: number) => alpha[y * width + x];
const columns = Array.from({ length: width }, (_, x) => x);

test('the halo is strongest along the bottom and fades upward', () => {
  const row = (y: number) => columns.reduce((sum, x) => sum + at(x, y), 0);
  assert.ok(row(height - 1) > row(height - 4));
  assert.ok(row(height - 4) > row(height - 8));
});

test('the glow dissolves at its edge instead of stopping on a step', () => {
  for (const x of columns) {
    let y = 0;
    while (y < height && at(x, y) === 0) y++;
    if (y < height)
      assert.ok(at(x, y) < 24, `column ${x} starts at ${at(x, y)}`);
  }
});

test('the halo leaves the top row clear', () => {
  for (const x of columns) assert.equal(at(x, 0), 0);
});

test('the halo edge is ragged: columns reach different heights', () => {
  const tops = columns.map((x) => {
    let y = 0;
    while (y < height && at(x, y) === 0) y++;
    return y;
  });
  assert.ok(Math.max(...tops) - Math.min(...tops) > height / 8);
});

test('the edge stays in [-1, 1], repeats per seed and differs between profiles', () => {
  for (let x = 0; x <= 1; x += 0.01) {
    const value = haloEdge(x, 42);
    assert.ok(Math.abs(value) <= 1);
    assert.equal(haloEdge(x, 42), value);
  }
  assert.notEqual(haloEdge(0.5, 1), haloEdge(0.5, 2));
});

test('over time the edge reshapes, not just slides', () => {
  const later = haloAlpha(width, height, 1234, { time: 4 });
  const slid = haloAlpha(width, height, 1234, { shift: 0.1 });
  const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
    a.some((value, i) => value !== b[i]);
  assert.ok(differs(alpha, later));
  assert.ok(differs(later, slid));
});

test('the edge repeats every sidebar width, so Drift never shows a seam', () => {
  for (let x = 0; x < 1; x += 0.05)
    assert.ok(Math.abs(haloEdge(x, 7, 3) - haloEdge(x + 1, 7, 3)) < 1e-9);
});

test('raggedness 0 is a flat edge and 100 swings further than the default', () => {
  const flat = haloAlpha(width, height, 1234, { raggedness: 0 });
  const tops = (a: Uint8ClampedArray) =>
    columns.map((x) => {
      let y = 0;
      while (y < height && a[y * width + x] === 0) y++;
      return y;
    });
  const spread = (a: Uint8ClampedArray) =>
    Math.max(...tops(a)) - Math.min(...tops(a));
  assert.equal(spread(flat), 0);
  assert.ok(
    spread(haloAlpha(width, height, 1234, { raggedness: 100 })) > spread(alpha),
  );
});
