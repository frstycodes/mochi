import assert from 'node:assert/strict';
import { afterEach, onTestFinished, test, vi } from 'vite-plus/test';
import { clockFor } from './useNow.ts';

afterEach(() => vi.useRealTimers());

test('clocks share a timer per granularity, pause while hidden, refresh on return, and stop when unused', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: 1000 });
  const document = Object.assign(new EventTarget(), { hidden: false });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  onTestFinished(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const clock = clockFor(1000);
  assert.equal(clockFor(1000), clock);
  let updates = 0;
  const unsubscribe = clock.subscribe(() => updates++);
  const other = clock.subscribe(() => updates++);
  vi.advanceTimersByTime(1000);
  assert.equal(clock.getSnapshot(), 2000);
  assert.equal(updates, 3);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(5000);
  assert.equal(clock.getSnapshot(), 2000);
  assert.equal(updates, 3);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(clock.getSnapshot(), 7000);
  unsubscribe();
  vi.advanceTimersByTime(1000);
  assert.equal(updates, 6);
  other();
  vi.advanceTimersByTime(1000);
  assert.equal(clock.getSnapshot(), 8000);
  assert.equal(updates, 6);
  const idle = clockFor(null);
  const stop = idle.subscribe(() => assert.fail('idle clocks never tick'));
  vi.advanceTimersByTime(1000);
  assert.equal(idle.getSnapshot(), null);
  stop();
});
