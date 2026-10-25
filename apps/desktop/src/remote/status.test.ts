import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { presenceAge } from './status.ts';

test('last seen reads like a messenger badge, rounded down to the unit it fits, never below a minute', () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const ago = (minutes: number) => presenceAge(now - minutes * 60_000, now);
  assert.deepEqual(
    [
      ago(0.5),
      ago(1),
      ago(59),
      ago(60),
      ago(23 * 60 + 59),
      ago(24 * 60),
      ago(9 * 24 * 60),
    ],
    ['1m', '1m', '59m', '1h', '23h', '1d', '9d'],
  );
  assert.equal(
    presenceAge(now + 5000, now),
    '1m',
    'a clock a little ahead never reads as online',
  );
});
