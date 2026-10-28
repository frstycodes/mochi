import assert from 'node:assert/strict';
import { onTestFinished, test, vi } from 'vite-plus/test';
import type { Action } from '../store/index.tsx';
import { expectedFor, openStarted } from './expecting.ts';

test('a created remote thread opens by its machine-aware id and waits for the mirror', () => {
  const dispatched: Action[] = [];
  const opened = openStarted(
    'm1',
    { isOk: true, data: { threadId: 'new-7' } },
    (a) => dispatched.push(a),
  );
  assert.ok(opened);
  assert.deepEqual(dispatched, [
    { type: 'go', view: { kind: 'thread', id: 'm1~new-7' } },
  ]);
  assert.ok(expectedFor('m1~new-7') > 0);
  assert.equal(expectedFor('m1~other'), 0);
});

test('the wait ends after the grace period', () => {
  vi.useFakeTimers();
  onTestFinished(() => void vi.useRealTimers());
  openStarted('m2', { isOk: true, data: { threadId: 'new-1' } }, () => {});
  assert.ok(expectedFor('m2~new-1') > 0);
  vi.advanceTimersByTime(16_000);
  assert.equal(expectedFor('m2~new-1'), 0);
});

test('a result without a thread id opens nothing', () => {
  const dispatched: Action[] = [];
  assert.equal(
    openStarted('m1', { isOk: true }, (a) => dispatched.push(a)),
    false,
  );
  assert.deepEqual(dispatched, []);
});
