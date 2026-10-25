import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { hasGaps, transcriptGaps } from './transcriptGaps.ts';

const rows = [
  { top: 100, bottom: 300 },
  { top: 320, bottom: 400 },
  { top: 420, bottom: 900 },
];

test('rows covering the view, where the virtualizer put them, have no gaps', () => {
  const gaps = transcriptGaps(
    rows,
    [100, 320, 420],
    { top: 150, bottom: 850 },
    20,
  );
  assert.deepEqual(gaps, { above: 0, below: 0, seams: [], drift: 0 });
  assert.equal(hasGaps(gaps), false);
});

test('rows rendered below a stale scroll margin leave the top of the view empty and drift from their starts', () => {
  const shifted = rows.map((r) => ({
    top: r.top + 400,
    bottom: r.bottom + 400,
  }));
  const gaps = transcriptGaps(
    shifted,
    [100, 320, 420],
    { top: 150, bottom: 850 },
    20,
  );
  assert.equal(gaps.above, 350);
  assert.equal(gaps.drift, 400);
  assert.equal(hasGaps(gaps), true);
});

test('a window that ends above the bottom of the view leaves a gap below', () => {
  assert.equal(
    transcriptGaps(rows, [100, 320, 420], { top: 500, bottom: 1000 }, 20).below,
    100,
  );
});

test('rows that overlap or part by more than the row gap are seams', () => {
  const torn = [rows[0], { top: 360, bottom: 400 }, { top: 410, bottom: 900 }];
  assert.deepEqual(
    transcriptGaps(torn, [100, 360, 410], { top: 150, bottom: 850 }, 20).seams,
    [
      [0, 1],
      [1, 2],
    ],
  );
});

test('a window entirely off screen counts the whole view, not a negative span', () => {
  assert.equal(
    transcriptGaps(rows, [100, 320, 420], { top: 2000, bottom: 2500 }, 20)
      .below,
    500,
  );
  assert.equal(
    transcriptGaps(rows, [100, 320, 420], { top: 0, bottom: 50 }, 20).above,
    50,
  );
});

test('nothing rendered or nothing in view is not a gap', () => {
  assert.equal(
    hasGaps(transcriptGaps([], [], { top: 0, bottom: 500 }, 20)),
    false,
  );
  assert.equal(
    hasGaps(
      transcriptGaps(rows, [100, 320, 420], { top: 500, bottom: 500 }, 20),
    ),
    false,
  );
});
