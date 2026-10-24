import { browserStorage } from '../lib/uiStorage.ts';
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const storage = new Map<string, string>();
mock.method(browserStorage, 'getItem', (key: string) => storage.get(key) ?? null);
mock.method(browserStorage, 'setItem', (key: string, value: string) => void storage.set(key, value));
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
  assert.equal(JSON.parse(storage.get(PREFS_KEY)!).state.value.searchEngine, 'kagi');
  assert.equal(calls, 1);
  storage.set(PREFS_KEY, JSON.stringify({ searchEngine: 'bing' }));
  reloadPrefs();
  assert.equal(getPrefs().searchEngine, 'bing');
  assert.equal(calls, 2);
  unsubscribe();
});

test("new threads' temp branches start with mochi/ by default, follow the Branch prefix setting, and the old '' default becomes mochi/", async () => {
  assert.equal(DEFAULT_PREFS.branchPrefix, 'mochi/');
  assert.equal(parsePrefs(JSON.stringify({ branchPrefix: '' }), null).branchPrefix, 'mochi/');
  const { initialThreads, threadsReducer } = await import('../store/threads.ts');
  const create = { type: 'create', title: 'x', provider: 'claude', project: '/Users/me/dev/app' } as const;
  const branchOf = () => threadsReducer({ ...initialThreads(), spaceId: 'latitude', views: {} } as never, create).threads.at(-1)!.repo!.branch;
  setPrefs({ branchPrefix: DEFAULT_PREFS.branchPrefix });
  assert.match(branchOf(), /^mochi\/[0-9a-f]{8}$/);
  setPrefs({ branchPrefix: 'me/' });
  assert.match(branchOf(), /^me\/[0-9a-f]{8}$/);
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

test('goals stay off: a saved goals: true from before they were retired is ignored', () => {
  assert.equal(parsePrefs(JSON.stringify({ goals: true })).goals, false);
});
