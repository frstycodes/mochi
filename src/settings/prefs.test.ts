import assert from 'node:assert/strict';
import { test } from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
});
const { DEFAULT_PREFS, PREFS_KEY, getPrefs, parsePrefs, reloadPrefs, setPrefs, subscribePrefs } = await import('./prefs.ts');

test('parsePrefs falls back to defaults for missing, mistyped and unparseable values', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('not json'), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('[1,2]'), DEFAULT_PREFS);
  const prefs = parsePrefs(JSON.stringify({ terminalFontSize: '14', dockBadge: false, starredModels: ['a', 2], branchPrefix: 'me/' }));
  assert.equal(prefs.terminalFontSize, DEFAULT_PREFS.terminalFontSize);
  assert.equal(prefs.dockBadge, false);
  assert.deepEqual(prefs.starredModels, DEFAULT_PREFS.starredModels);
  assert.equal(prefs.branchPrefix, 'me/');
});

test('parsePrefs carries over the drift card\'s old branch-from choice only when the store has none', () => {
  assert.equal(parsePrefs(null, 'base').branchFrom, 'base');
  assert.equal(parsePrefs(JSON.stringify({ branchFrom: 'current' }), 'base').branchFrom, 'current');
});

test('setPrefs persists, notifies, and survives a reload from storage', () => {
  let calls = 0;
  const unsubscribe = subscribePrefs(() => calls++);
  setPrefs({ searchEngine: 'kagi' });
  assert.equal(getPrefs().searchEngine, 'kagi');
  assert.equal(JSON.parse(storage.get(PREFS_KEY)!).searchEngine, 'kagi');
  assert.equal(calls, 1);
  storage.set(PREFS_KEY, JSON.stringify({ searchEngine: 'bing' }));
  reloadPrefs();
  assert.equal(getPrefs().searchEngine, 'bing');
  assert.equal(calls, 2);
  unsubscribe();
});
