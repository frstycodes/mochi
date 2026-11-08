import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';
import { menuNavDirection, forwardMenuNav } from './menuNav.ts';

/** Minimal keyboard event for testing. */
const key = (
  code: string,
  overrides: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
    isComposing: boolean;
  }> = {},
): KeyboardEvent =>
  ({
    code,
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    ...overrides,
  }) as unknown as KeyboardEvent;

test('arrow keys always navigate regardless of overrides', () => {
  assert.equal(
    menuNavDirection(key('ArrowDown', { key: 'ArrowDown' }), {}),
    'next',
  );
  assert.equal(
    menuNavDirection(key('ArrowUp', { key: 'ArrowUp' }), {}),
    'prev',
  );
});

test('menu-next default (nav+N = Ctrl+N on macOS) returns next', () => {
  // nav = Ctrl on macOS
  assert.equal(
    menuNavDirection(key('KeyN', { ctrlKey: true }), {}, true),
    'next',
  );
});

test('menu-previous default (nav+P = Ctrl+P on macOS) returns prev', () => {
  assert.equal(
    menuNavDirection(key('KeyP', { ctrlKey: true }), {}, true),
    'prev',
  );
});

test('menu-next default (mod+N = Ctrl+N on PC) returns next', () => {
  // mod = Ctrl on Windows/Linux
  assert.equal(
    menuNavDirection(key('KeyN', { ctrlKey: true }), {}, false),
    'next',
  );
});

test('menu-previous default (mod+P = Ctrl+P on PC) returns prev', () => {
  assert.equal(
    menuNavDirection(key('KeyP', { ctrlKey: true }), {}, false),
    'prev',
  );
});

test('unrelated keys return null', () => {
  assert.equal(menuNavDirection(key('KeyJ'), {}), null);
  assert.equal(menuNavDirection(key('Enter', { key: 'Enter' }), {}), null);
  assert.equal(menuNavDirection(key('Escape', { key: 'Escape' }), {}), null);
});

test('user-rebound menu-next fires on the new chord', () => {
  // User rebound menu-next to Ctrl+J (nav+J) on macOS
  const overrides = { 'menu-next': 'nav+J' };
  assert.equal(
    menuNavDirection(key('KeyJ', { ctrlKey: true }), overrides, true),
    'next',
  );
  // The old default (Ctrl+N) no longer fires
  assert.equal(
    menuNavDirection(key('KeyN', { ctrlKey: true }), overrides, true),
    null,
  );
});

test('user-rebound menu-previous fires on the new chord', () => {
  // User rebound menu-previous to Ctrl+K (nav+K) on macOS
  const overrides = { 'menu-previous': 'nav+K' };
  assert.equal(
    menuNavDirection(key('KeyK', { ctrlKey: true }), overrides, true),
    'prev',
  );
  // The old default (Ctrl+P) no longer fires
  assert.equal(
    menuNavDirection(key('KeyP', { ctrlKey: true }), overrides, true),
    null,
  );
});

test('user can clear a binding; arrow keys still work', () => {
  const overrides = { 'menu-next': '', 'menu-previous': '' };
  assert.equal(
    menuNavDirection(key('ArrowDown', { key: 'ArrowDown' }), overrides),
    'next',
  );
  assert.equal(
    menuNavDirection(key('ArrowUp', { key: 'ArrowUp' }), overrides),
    'prev',
  );
  // The cleared binding does not fire
  assert.equal(
    menuNavDirection(key('KeyN', { ctrlKey: true }), overrides, true),
    null,
  );
});

test('consumed events are ignored', () => {
  assert.equal(
    menuNavDirection(
      key('KeyN', { ctrlKey: true, defaultPrevented: true }),
      {},
      true,
    ),
    null,
  );
});

test('IME composition events are ignored', () => {
  assert.equal(
    menuNavDirection(
      key('KeyN', { ctrlKey: true, isComposing: true }),
      {},
      true,
    ),
    null,
  );
});

test('configured navigation forwards one arrow event and leaves other keys alone', () => {
  const events: Event[] = [];
  vi.stubGlobal(
    'KeyboardEvent',
    class extends Event {
      key: string;
      constructor(type: string, options: KeyboardEventInit) {
        super(type, options);
        this.key = options.key ?? '';
      }
    },
  );
  try {
    const list = {
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
    } as HTMLElement;
    assert.equal(
      forwardMenuNav(
        key('KeyJ', { ctrlKey: true }),
        list,
        { 'menu-next': 'nav+J' },
        true,
      ),
      true,
    );
    assert.equal(events.length, 1);
    assert.equal((events[0] as KeyboardEvent).key, 'ArrowDown');
    assert.equal(events[0].bubbles, true);
    assert.equal(forwardMenuNav(key('KeyX'), list, {}, true), false);
    assert.equal(events.length, 1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('composition and consumed arrow events stay with the editor', () => {
  assert.equal(
    menuNavDirection(
      key('ArrowDown', { key: 'ArrowDown', isComposing: true }),
      {},
    ),
    null,
  );
  assert.equal(
    menuNavDirection(
      key('ArrowUp', { key: 'ArrowUp', defaultPrevented: true }),
      {},
    ),
    null,
  );
});
