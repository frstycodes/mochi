import assert from 'node:assert/strict';
import { afterEach, onTestFinished, test, vi } from 'vite-plus/test';
import { clockFor } from './useNow.ts';

afterEach(() => vi.useRealTimers());

test('clocks share a timer per granularity, pause while hidden, refresh on return, and stop when unused', () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval'],
    now: 1000,
  });
  const document = Object.assign(new EventTarget(), { hidden: false });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  });
  onTestFinished(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const clock = clockFor(1000);
  assert.equal(clockFor(1000), clock);
  let updates = 0;
  clock.store.subscribe(() => updates++);
  const release = clock.retain();
  const other = clock.retain();
  assert.equal(updates, 1);
  vi.advanceTimersByTime(1000);
  assert.equal(clock.store.getState().now, 2000);
  assert.equal(updates, 2);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(5000);
  assert.equal(clock.store.getState().now, 2000);
  assert.equal(updates, 2);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(clock.store.getState().now, 7000);
  release();
  vi.advanceTimersByTime(1000);
  assert.equal(updates, 4);
  other();
  vi.advanceTimersByTime(1000);
  assert.equal(clock.store.getState().now, 8000);
  assert.equal(updates, 4);
  const idle = clockFor(null);
  idle.store.subscribe(() => assert.fail('idle clocks never tick'));
  const stop = idle.retain();
  vi.advanceTimersByTime(1000);
  assert.equal(idle.store.getState().now, null);
  stop();
});
