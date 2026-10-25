import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DOCK_DRAG_RATIO,
  DOCK_WHEEL_RATIO,
  EFFORT_STEP_PX,
  dockDragOffset,
  dragSteps,
  wheelPx,
  wheelStep,
} from './scrub.ts';

// GAP: synthetic, not a recorded device trace. A medium trackpad swipe: 10 tracking events, then momentum decaying 0.88 a frame (275px).
const SWIPE = [
  4,
  9,
  14,
  18,
  20,
  20,
  19,
  17,
  15,
  13,
  ...Array.from({ length: 24 }, (_, i) => Math.round(16 * 0.88 ** i)),
].filter((d) => d > 0);
const NOTCH = [100];
const DOCK_SPACING = 46;
const LOG = process.env.SCRUB_LOG === '1';

/** Levels a stepper of `count` values moves from `from` over one gesture. */
function stepsFor(
  deltas: number[],
  count: number,
  from: number,
  stepPx: number,
) {
  let acc = 0;
  let at = from;
  for (const d of deltas) {
    const r = wheelStep(acc, d, at, count, stepPx);
    acc = r.acc;
    at += r.step;
  }
  return at - from;
}

const dockItems = (deltas: number[], ratio: number) =>
  Math.round((deltas.reduce((a, b) => a + b, 0) * ratio) / DOCK_SPACING);

test('effort steps once per 64px and at most once per wheel event', () => {
  assert.equal(EFFORT_STEP_PX, 64);
  assert.deepEqual(wheelStep(0, 63, 2, 5), { acc: 63, step: 0 });
  assert.deepEqual(wheelStep(63, 1, 2, 5), { acc: 0, step: 1 });
  assert.deepEqual(
    wheelStep(0, 500, 0, 5),
    { acc: 0, step: 1 },
    'one huge event is still one level',
  );
  assert.deepEqual(wheelStep(0, -40, 2, 5), { acc: -40, step: 0 });
});

test('effort banks no distance past either end', () => {
  assert.deepEqual(wheelStep(0, 50, 4, 5), { acc: 0, step: 0 });
  assert.deepEqual(wheelStep(0, -50, 0, 5), { acc: 0, step: 0 });
  assert.equal(
    stepsFor([...Array(20).fill(30), -64], 5, 3, EFFORT_STEP_PX),
    0,
    'pinned at the top, the first 64px back steps down',
  );
});

test('a trackpad swipe moves effort half as far as before, a mouse notch stays one level', () => {
  const before = stepsFor(SWIPE, 9, 0, 32);
  const after = stepsFor(SWIPE, 9, 0, EFFORT_STEP_PX);
  assert.equal(after, Math.floor(SWIPE.reduce((a, b) => a + b, 0) / 64));
  assert.ok(after <= before / 2 + 1);
  assert.equal(stepsFor(NOTCH, 5, 0, 32), 1);
  assert.equal(stepsFor(NOTCH, 5, 0, EFFORT_STEP_PX), 1);
  assert.equal(dragSteps(127), 1);
  assert.equal(dragSteps(-128), -2);
  if (LOG)
    console.log(
      [
        `swipe: ${SWIPE.length} events, ${SWIPE.reduce((a, b) => a + b, 0)}px`,
        `effort, trackpad swipe: before ${before} levels, after ${after}`,
        `effort, mouse notch (100px): before ${stepsFor(NOTCH, 5, 0, 32)}, after ${stepsFor(NOTCH, 5, 0, EFFORT_STEP_PX)}`,
        `effort, drag 200px: before ${dragSteps(200, 32)}, after ${dragSteps(200)}`,
      ].join('\n'),
    );
});

test('the model dock moves half a strip px per wheel and drag px', () => {
  assert.equal(DOCK_WHEEL_RATIO, 0.5);
  assert.equal(DOCK_DRAG_RATIO, 0.5);
  assert.equal(dockDragOffset(-92, 'x'), 46, 'drag left moves forward');
  assert.equal(dockDragOffset(92, 'y'), 46, 'drag down moves forward');
  assert.equal(wheelPx(3, 1, 800), 48, 'Firefox line deltas');
  assert.equal(dockItems(NOTCH, DOCK_WHEEL_RATIO), 1);
  if (LOG)
    console.log(
      [
        `dock, trackpad swipe over the chip: before ${dockItems(SWIPE, 1)} items, after ${dockItems(SWIPE, DOCK_WHEEL_RATIO)}`,
        `dock, mouse notch (100px): before ${dockItems(NOTCH, 1)}, after ${dockItems(NOTCH, DOCK_WHEEL_RATIO)}`,
        `dock, drag 200px: before ${Math.round(200 / DOCK_SPACING)} items, after ${Math.round(dockDragOffset(200, 'y') / DOCK_SPACING)}`,
      ].join('\n'),
    );
});
