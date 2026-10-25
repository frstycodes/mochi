// Node reads TZ on each Date call once it's set, and `node --test` runs every file in its own process.
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { describeCron, nextRun, nextRuns, parseCron } from './cron.ts';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const iso = (at: number | null) =>
  at === null ? null : new Date(at).toISOString();

test('parses lists, ranges, steps and names, and rejects bad fields', () => {
  const c = parseCron('*/15 9-17/4 1,15 jan-mar mon-fri');
  assert.deepEqual([...c.minutes], [0, 15, 30, 45]);
  assert.deepEqual([...c.hours], [9, 13, 17]);
  assert.deepEqual([...c.months], [1, 2, 3]);
  assert.deepEqual([...c.weekdays], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron('0 0 * * 7').weekdays], [0]);
  assert.throws(() => parseCron('0 0 * *'), /five fields/);
  assert.throws(() => parseCron('60 0 * * *'), /minute/);
  assert.throws(() => parseCron('0 5-2 * * *'), /hour.*range/);
  assert.throws(() => parseCron('*/0 * * * *'), /step/);
});

test('next run is strictly after the given time', () => {
  assert.equal(
    nextRun('0 9 * * *', local(2026, 10, 12, 9, 0)),
    local(2026, 10, 13, 9, 0),
  );
  assert.equal(
    nextRun('0 9 * * *', local(2026, 10, 12, 8, 59)),
    local(2026, 10, 12, 9, 0),
  );
  // Mon 2026-10-12 → weekdays skip the weekend.
  assert.deepEqual(nextRuns('30 7 * * 1-5', local(2026, 10, 16, 8), 2), [
    local(2026, 10, 19, 7, 30),
    local(2026, 10, 20, 7, 30),
  ]);
});

test('end of month: day 31 skips short months, Feb 29 waits for a leap year', () => {
  assert.equal(nextRun('0 9 31 * *', local(2026, 4, 1)), local(2026, 5, 31, 9));
  assert.equal(
    nextRun('0 9 31 * *', local(2026, 5, 31, 9)),
    local(2026, 7, 31, 9),
  );
  assert.equal(nextRun('0 0 29 2 *', local(2026, 1, 1)), local(2028, 2, 29));
  assert.equal(nextRun('0 0 30 2 *', local(2026, 1, 1)), null);
});

test('both day fields restricted means either one', () => {
  // The 13th, or any Friday: Fri Oct 16 comes before Nov 13.
  assert.equal(
    nextRun('0 0 13 * 5', local(2026, 10, 13, 1)),
    local(2026, 10, 16),
  );
});

test('DST spring forward: a skipped 02:30 runs when the clock jumps, once', () => {
  // 2026-03-08 02:00 EST → 03:00 EDT.
  assert.equal(
    iso(nextRun('30 2 * * *', local(2026, 3, 8))),
    '2026-03-08T07:30:00.000Z',
  );
  assert.equal(
    iso(nextRun('30 2 * * *', Date.parse('2026-03-08T07:30:00Z'))),
    '2026-03-09T06:30:00.000Z',
  );
  // Hourly keeps going across the gap without a duplicate.
  assert.deepEqual(
    nextRuns('0 * * * *', Date.parse('2026-03-08T06:30:00Z'), 2).map(iso),
    ['2026-03-08T07:00:00.000Z', '2026-03-08T08:00:00.000Z'],
  );
});

test('DST fall back: a repeated 01:30 runs once', () => {
  // 2026-11-01 02:00 EDT → 01:00 EST.
  const first = nextRun('30 1 * * *', local(2026, 11, 1));
  assert.equal(iso(first), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(nextRun('30 1 * * *', first!)), '2026-11-02T06:30:00.000Z');
});

test('describes common shapes in words', () => {
  assert.equal(describeCron('0 2 * * *'), 'Every day at 02:00');
  assert.equal(describeCron('15 9 * * 1-5'), 'Weekdays at 09:15');
  assert.equal(describeCron('0 * * * *'), 'Every hour at :00');
  assert.equal(describeCron('*/10 * * * *'), 'Every 10 minutes');
  assert.equal(describeCron('0 8 * * 1,3'), 'Mon, Wed at 08:00');
  assert.equal(describeCron('0 8 1 * *'), 'Monthly on day 1 at 08:00');
  assert.equal(describeCron('0 8 1 1 *'), 'Custom schedule');
  assert.equal(describeCron('nope'), 'Not a valid schedule');
});
