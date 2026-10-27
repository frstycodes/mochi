import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useStickToBottom } from 'use-stick-to-bottom';
import { afterEach, onTestFinished, test, vi } from 'vite-plus/test';
import { isKeyUp, isWheelUp } from './scrollIntent.ts';

afterEach(() => vi.useRealTimers());

test('upward wheels and keys read as scrolling up; sideways trackpad noise does not', () => {
  assert.equal(isWheelUp({ deltaX: 0, deltaY: -1 }), true);
  assert.equal(isWheelUp({ deltaX: 0, deltaY: 3 }), false);
  assert.equal(isWheelUp({ deltaX: 12, deltaY: -1 }), false);
  for (const key of ['ArrowUp', 'PageUp', 'Home'])
    assert.equal(isKeyUp({ key, shiftKey: false, metaKey: false }), true);
  assert.equal(isKeyUp({ key: ' ', shiftKey: true, metaKey: false }), true);
  assert.equal(isKeyUp({ key: ' ', shiftKey: false, metaKey: false }), false);
  assert.equal(
    isKeyUp({ key: 'ArrowUp', shiftKey: true, metaKey: false }),
    false,
  );
});

// The patched use-stick-to-bottom (patches/use-stick-to-bottom@1.1.6.patch): a shrink within 70px of the bottom used to re-pin a reader who
// had just scrolled up, and the next growth pulled them back down.
test('a reader who scrolls up stays released through shrinks and growth until they scroll back to the bottom', async () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'],
  });
  const { scroller, resize, pin } = mountPin();
  const bottom = () => scroller.scrollHeight - 1 - scroller.clientHeight;
  const settle = () => vi.advanceTimersByTimeAsync(100);

  resize(1000);
  await settle();
  assert.equal(scroller.scrollTop, bottom());
  assert.equal(pin.state.isAtBottom, true);

  pin.stopScroll();
  scroller.scrollTop -= 10;
  scroller.dispatchEvent(new Event('scroll'));
  await settle();
  assert.equal(pin.state.isAtBottom, false);

  resize(990);
  await settle();
  assert.equal(
    pin.state.isAtBottom,
    false,
    'a shrink near the bottom re-pinned the reader',
  );

  const readerAt = scroller.scrollTop;
  resize(1014);
  await settle();
  assert.equal(
    scroller.scrollTop,
    readerAt,
    'growth pulled the reader back down',
  );

  scroller.scrollTop = bottom();
  scroller.dispatchEvent(new Event('scroll'));
  await settle();
  assert.equal(pin.state.isAtBottom, true);
  resize(1030);
  await settle();
  assert.equal(scroller.scrollTop, bottom());
});

/** The hook with a fake scroller and content: no DOM in tests. `resize` sets the content height and fires the library's ResizeObserver. */
function mountPin() {
  const observers: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  // Node has no frames; the library chains its scroll loop through them and reads its own clock.
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) =>
    setTimeout(() => frame(0), 16),
  );
  vi.stubGlobal('getComputedStyle', () => ({
    overflow: 'auto',
    scrollBehavior: 'auto',
  }));
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });

  const scroller = Object.assign(new EventTarget(), {
    scrollTop: 0,
    scrollHeight: 500,
    clientHeight: 500,
  });
  let pin!: ReturnType<typeof useStickToBottom>;
  renderToString(createElement(Probe, { onPin: (p) => (pin = p) }));
  pin.scrollRef(scroller as unknown as HTMLElement);
  pin.contentRef({} as HTMLElement);

  const resize = (height: number) => {
    scroller.scrollHeight = height;
    scroller.scrollTop = Math.min(
      scroller.scrollTop,
      height - scroller.clientHeight,
    );
    const entry = { contentRect: { height } } as ResizeObserverEntry;
    for (const callback of observers) callback([entry], {} as ResizeObserver);
  };
  return { scroller, resize, pin };
}

function Probe({
  onPin,
}: {
  onPin: (pin: ReturnType<typeof useStickToBottom>) => void;
}) {
  onPin(useStickToBottom({ initial: 'instant', resize: 'instant' }));
  return null;
}
