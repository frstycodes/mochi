import assert from 'node:assert/strict';
import { test } from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
});
const { DEFAULT_SPACES } = await import('./model.ts');
const { MAX_PROFILES, PROFILES_KEY, addProfile, getProfiles, newProfileId, parseProfiles, removeProfile, updateProfile } = await import('./profiles.ts');

test('parseProfiles keeps valid entries and falls back to the built-in profiles', () => {
  assert.deepEqual(parseProfiles(null), DEFAULT_SPACES);
  assert.deepEqual(parseProfiles('{}'), DEFAULT_SPACES);
  assert.deepEqual(parseProfiles('[{"id":"Bad Id","name":"x"}]'), DEFAULT_SPACES);
  const kept = { id: 'side', name: 'Side', icon: 'rocket', plans: { claude: '', codex: '' }, github: '' };
  assert.deepEqual(parseProfiles(JSON.stringify([kept, { id: 'no-icon', name: 'N', plans: { claude: '', codex: '' }, github: '' }])), [kept]);
});

test('newProfileId makes a session-safe slug that never collides', () => {
  assert.equal(newProfileId('Side Project!', []), 'side-project');
  assert.equal(newProfileId('Side project', ['side-project', 'side-project-2']), 'side-project-3');
  assert.equal(newProfileId('🚀', []), 'profile');
});

test('add, rename, remove and undo keep the order and persist', () => {
  const added = addProfile('Personal');
  assert.equal(added.id, 'personal-2');
  assert.notEqual(added.icon, 'home');
  updateProfile(added.id, { name: 'Weekend' });
  assert.equal(getProfiles().at(-1)!.name, 'Weekend');
  const undo = removeProfile('personal');
  assert.deepEqual(getProfiles().map((p) => p.id), ['latitude', 'liane', 'personal-2']);
  undo();
  assert.deepEqual(getProfiles().map((p) => p.id), ['latitude', 'personal', 'liane', 'personal-2']);
  assert.equal(JSON.parse(storage.get(PROFILES_KEY)!).length, 4);
});

test('the last profile stays and the list stops at the cap', () => {
  for (const p of getProfiles().slice(1)) removeProfile(p.id);
  assert.throws(() => removeProfile(getProfiles()[0].id), /at least one/);
  while (getProfiles().length < MAX_PROFILES) addProfile('More');
  assert.throws(() => addProfile('One too many'), /up to 9/);
});
