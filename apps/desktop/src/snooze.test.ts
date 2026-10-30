import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { snoozeTimes, wakeLabel } from './snooze.ts';

const at = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m, d, h, 0, 0, 0);

test('next week lands on the coming Monday at 9, never today', () => {
  const nextWeek = (now: Date) => new Date(snoozeTimes(now)[2].at);
  // Thu 29 Oct 2026 → Mon 2 Nov; Sun 1 Nov → Mon 2 Nov; Mon 2 Nov → Mon 9 Nov.
  assert.deepEqual(nextWeek(at(2026, 9, 29, 14)), at(2026, 10, 2));
  assert.deepEqual(nextWeek(at(2026, 10, 1, 14)), at(2026, 10, 2));
  assert.deepEqual(nextWeek(at(2026, 10, 2, 14)), at(2026, 10, 9));
});

test('the wake label names the day only when it is not today', () => {
  const now = at(2026, 9, 30, 14);
  assert.doesNotMatch(
    wakeLabel(at(2026, 9, 30, 17).getTime(), now),
    /tomorrow|\b[A-Z][a-z]{2}\b/,
  );
  assert.match(wakeLabel(at(2026, 9, 31).getTime(), now), /^tomorrow /);
  assert.match(wakeLabel(at(2026, 10, 2).getTime(), now), /^Mon /);
});
