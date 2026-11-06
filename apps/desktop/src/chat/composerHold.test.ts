import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';
import { COMPOSER_SETTLE_MS, composerHold } from './composerHold.ts';

const FULL = 108;
const FOLDED = 54;

let writes: (number | undefined)[];
let holder: ReturnType<typeof composerHold>;

beforeEach(() => {
  vi.useFakeTimers();
  writes = [];
  holder = composerHold((px) => writes.push(px));
});
afterEach(() => vi.useRealTimers());

test('reaching the end while folded keeps the padding until the unfold grows back to the held height', () => {
  holder.hold(FULL);
  holder.resized(FOLDED);
  holder.release();
  // The reader's wheel keeps reporting the end while the composer unfolds.
  for (const height of [60, 75, 90, 100]) {
    holder.resized(height);
    holder.release();
    vi.advanceTimersByTime(16);
  }
  assert.deepEqual(writes, [FULL]);
  holder.resized(FULL);
  assert.deepEqual(writes, [FULL, undefined]);
});

test('a composer that never grows back lets go once it stops resizing', () => {
  holder.hold(FULL);
  holder.release();
  vi.advanceTimersByTime(COMPOSER_SETTLE_MS - 1);
  assert.deepEqual(writes, [FULL]);
  vi.advanceTimersByTime(1);
  assert.deepEqual(writes, [FULL, undefined]);
});

test('scrolling back up before the release lands keeps the hold', () => {
  holder.hold(FULL);
  holder.release();
  holder.hold(FOLDED);
  vi.advanceTimersByTime(COMPOSER_SETTLE_MS * 2);
  assert.deepEqual(writes, [FULL]);
});
