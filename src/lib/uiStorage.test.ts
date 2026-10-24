import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { browserStorage, persistedFamily, persistedSlice } from './uiStorage.ts';

const storage = new Map<string, string>();
mock.method(browserStorage, 'getItem', (key: string) => storage.get(key) ?? null);
mock.method(browserStorage, 'setItem', (key: string, value: string) => void storage.set(key, value));
mock.method(browserStorage, 'removeItem', (key: string) => void storage.delete(key));

test('legacy values hydrate synchronously, migrate to version one and survive a fresh slice', () => {
  for (const [key, raw, fallback, expected] of [
    ['harness.sidebar-width', '320', 256, 320],
    ['toggle', 'false', true, false],
    ['harness.pins.v1', '{"thread":[{"id":"pin","index":2,"text":"saved"}]}', {}, { thread: [{ id: 'pin', index: 2, text: 'saved' }] }],
    ['mochi.summary-order.v1', '["changes","tasks"]', [], ['changes', 'tasks']],
  ] as const) {
    storage.set(key, raw);
    const slice = persistedSlice<unknown>(key, fallback);
    assert.equal(slice.persist.hasHydrated(), true);
    assert.deepEqual(slice.getState().value, expected);
    assert.deepEqual(JSON.parse(storage.get(key)!), { state: { value: expected }, version: 1 });
    assert.deepEqual(persistedSlice<unknown>(key, fallback).getState().value, expected);
  }
});

test('updates persist, rehydration reads another window, and missing or malformed values fall back', () => {
  const slice = persistedSlice('reload', true);
  slice.setState({ value: false });
  assert.equal(persistedSlice('reload', true).getState().value, false);
  storage.set('reload', JSON.stringify({ state: { value: true }, version: 1 }));
  void slice.persist.rehydrate();
  assert.equal(slice.getState().value, true);
  for (const raw of ['{broken', 'null']) {
    storage.set('reload', raw);
    assert.equal(persistedSlice('reload', true).getState().value, true);
  }
  storage.delete('reload');
  void slice.persist.rehydrate();
  assert.equal(slice.getState().value, true);
});

test('dynamic slices import each old key and keep their values separate', () => {
  storage.set('harness.terminal.v1:one', '{"sessions":[{"id":"shell"}]}');
  const family = persistedFamily<{ sessions: { id: string }[] } | null>('harness.terminal.v1:', null);
  assert.deepEqual(family('one').getState().value, { sessions: [{ id: 'shell' }] });
  assert.equal(family('two').getState().value, null);
  assert.equal(family('one'), family('one'));
  family('one').setState({ value: null });
  family('one').persist.clearStorage();
  assert.equal(storage.has('harness.terminal.v1:one'), false);
});

test('blocked storage keeps session state, while theme saves can report the failure', () => {
  const blocked = mock.method(browserStorage, 'setItem', () => {
    throw new Error('quota');
  });
  try {
    const slice = persistedSlice('blocked', true);
    slice.setState({ value: false });
    assert.equal(slice.getState().value, false);
    const themes = persistedSlice('themes', {}, undefined, true);
    assert.throws(() => themes.setState({ value: { installed: [] } }), /quota/);
  } finally {
    blocked.mock.restore();
  }
});
