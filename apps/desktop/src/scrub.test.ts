import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DOCK_DRAG_RATIO,
  DOCK_WHEEL_RATIO,
  dockDragOffset,
  wheelPx,
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

const dockItems = (deltas: number[], ratio: number) =>
  Math.round((deltas.reduce((a, b) => a + b, 0) * ratio) / DOCK_SPACING);

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
