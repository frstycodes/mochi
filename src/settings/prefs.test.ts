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

test("new threads' branches have no prefix by default, follow the Branch prefix setting, and drop the old mochi/ default", async () => {
  assert.equal(DEFAULT_PREFS.branchPrefix, '');
  assert.equal(parsePrefs(JSON.stringify({ branchPrefix: 'mochi/' }), null).branchPrefix, '');
  const { initialThreads, threadsReducer } = await import('../store/threads.ts');
  const create = { type: 'create', title: 'x', provider: 'claude', project: '/Users/me/dev/app' } as const;
  const branchOf = () => threadsReducer({ ...initialThreads(), spaceId: 'latitude', views: {} } as never, create).threads.at(-1)!.repo!.branch;
  setPrefs({ branchPrefix: DEFAULT_PREFS.branchPrefix });
  assert.equal(branchOf(), 'feat/x');
  setPrefs({ branchPrefix: 'me/' });
  assert.equal(branchOf(), 'me/feat/x');
});

test('agent control: the old Reversible default becomes Everything (deletes and settings still ask); unknown values fall back', async () => {

  assert.equal(parsePrefs(JSON.stringify({ agentControl: 'reversible' })).agentControl, 'everything');
  assert.equal(parsePrefs(JSON.stringify({ agentControl: 'yolo' })).agentControl, 'everything');
  assert.equal(parsePrefs(JSON.stringify({ agentControl: 'read' })).agentControl, 'read');
  assert.equal(parsePrefs(JSON.stringify({ agentControl: 'changes' })).agentControl, 'changes');
});

test('prefs saved before launch load at startup, rebound shortcuts included; a malformed shortcut map falls back', async () => {
  storage.set(PREFS_KEY, JSON.stringify({ diffStyle: 'split', keybindings: { palette: 'mod+P' } }));
  // A query gives a fresh module instance, so its startup load reads the storage seeded above.
  const launched = (await import(`./prefs.ts?${'launch'}`)) as typeof import('./prefs.ts');
  assert.equal(launched.getPrefs().diffStyle, 'split');
  assert.deepEqual(launched.getPrefs().keybindings, { palette: 'mod+P' });
  assert.deepEqual(parsePrefs(JSON.stringify({ keybindings: { palette: 3 } })).keybindings, {});
  assert.deepEqual(parsePrefs(JSON.stringify({ keybindings: ['mod+P'] })).keybindings, {});
});

test('removed thread model restrictions are discarded from saved preferences', () => {
  for (const threadModels of ['cheaper', 'default', 'any'])
    assert.equal(Object.hasOwn(parsePrefs(JSON.stringify({ threadModels })), 'threadModels'), false);
});
