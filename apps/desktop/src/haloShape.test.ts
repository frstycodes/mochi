import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { haloAlpha, haloEdge } from './haloShape.ts';

const width = 64;
const height = 40;
const alpha = haloAlpha(width, height, 1234);
const at = (x: number, y: number) => alpha[y * width + x];
const columns = Array.from({ length: width }, (_, x) => x);

test('the halo is strongest along the bottom and fades upward', () => {
  for (const x of columns) {
    assert.ok(at(x, height - 1) > at(x, height - 4));
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
  assert.ok(Math.max(...tops) - Math.min(...tops) > height / 4);
});

test('the edge stays in [-1, 1], repeats per seed and differs between profiles', () => {
  for (let x = 0; x <= 1; x += 0.01) {
    const value = haloEdge(x, 42);
    assert.ok(Math.abs(value) <= 1);
    assert.equal(haloEdge(x, 42), value);
  }
  assert.notEqual(haloEdge(0.5, 1), haloEdge(0.5, 2));
});

test('the edge repeats every sidebar width, so Drift loops without a seam', () => {
  for (let x = 0; x < 1; x += 0.05)
    assert.ok(Math.abs(haloEdge(x, 7) - haloEdge(x + 1, 7)) < 1e-9);
});

test('a two-width canvas holds the same edge twice', () => {
  const double = haloAlpha(width * 2, height, 1234, 2);
  for (const x of columns)
    for (let y = 0; y < height; y++)
      assert.equal(
        double[y * width * 2 + x],
        double[y * width * 2 + x + width],
      );
});
