import { browserStorage } from './lib/uiStorage.ts';
import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';

const demo = vi.hoisted(() => ({ isOn: true }));
vi.mock('./demoData.ts', () => ({ showsDemoData: () => demo.isOn }));
const storage = new Map<string, string>();
vi.spyOn(browserStorage, 'getItem').mockImplementation(
  (key: string) => storage.get(key) ?? null,
);
vi.spyOn(browserStorage, 'setItem').mockImplementation(
  (key: string, value: string) => void storage.set(key, value),
);
const { DEFAULT_SPACES } = await import('./model.ts');
const {
  MAX_PROFILES,
  PROFILES_KEY,
  addProfile,
  followProfiles,
  getProfiles,
  newProfileId,
  parseProfiles,
  removeProfile,
  storedProfiles,
  updateProfile,
} = await import('./profiles.ts');
const { DEFAULT_CONTEXT, migratedContext } = await import('./store/context.ts');
const { createStore } = await import('zustand/vanilla');
type State = import('./store/types.ts').State;
type Space = import('./model.ts').Space;
type ProjectionContext = import('./store/context.ts').ProjectionContext;

// The window's replica as profiles.ts reads it: a `context` command replaces the context, as the reducer does.
const store = createStore<State>()(
  () => ({ context: DEFAULT_CONTEXT }) as State,
);
followProfiles({
  store,
  getState: store.getState,
  dispatch: (action) =>
    action.type === 'context' && store.setState({ context: action.context }),
});

test('parseProfiles keeps valid entries and falls back to the built-in profiles', () => {
  assert.deepEqual(parseProfiles(null), DEFAULT_SPACES);
  assert.deepEqual(parseProfiles('{}'), DEFAULT_SPACES);
  assert.deepEqual(
    parseProfiles('[{"id":"Bad Id","name":"x"}]'),
    DEFAULT_SPACES,
  );
  const kept = {
    id: 'side',
    name: 'Side',
    icon: 'rocket',
    plans: { claude: '', codex: '' },
    github: '',
  };
  assert.deepEqual(
    parseProfiles(
      JSON.stringify([
        kept,
        {
          id: 'no-icon',
          name: 'N',
          plans: { claude: '', codex: '' },
          github: '',
        },
      ]),
    ),
    [kept],
  );
});

test('newProfileId makes a session-safe slug that never collides', () => {
  assert.equal(newProfileId('Side Project!', []), 'side-project');
  assert.equal(
    newProfileId('Side project', ['side-project', 'side-project-2']),
    'side-project-3',
  );
  assert.equal(newProfileId('🚀', []), 'profile');
});

const stored: Space = {
  id: 'side',
  name: 'Side',
  icon: 'rocket',
  plans: { claude: '', codex: '' },
  github: 'octo',
  nativeOff: ['claude:default:skill:user:ui'],
  nativeNew: { codex: 'off' },
};

test('the migration reads the profiles this window stored before Core held them, whole', () => {
  storage.set(
    PROFILES_KEY,
    JSON.stringify({ state: { value: [stored] }, version: 1 }),
  );
  assert.deepEqual(storedProfiles(), [stored]);
  // Written before persist wrapped entries.
  storage.set(PROFILES_KEY, JSON.stringify([stored]));
  assert.deepEqual(storedProfiles(), [stored]);
  storage.delete(PROFILES_KEY);
  assert.deepEqual(storedProfiles(), DEFAULT_SPACES);
});

test('the first sync migrates profiles once: with the context, after it, never over Core’s', () => {
  const local = { ...DEFAULT_CONTEXT, pins: { t1: [] } };
  const read = () => [stored];
  assert.deepEqual(migratedContext(null, local, read), {
    ...local,
    profiles: [stored],
  });
  // Prefs and pins migrated before profiles did: Core's stay, the stored profiles join them.
  assert.deepEqual(migratedContext(DEFAULT_CONTEXT, local, read), {
    ...DEFAULT_CONTEXT,
    profiles: [stored],
  });
  assert.equal(
    migratedContext({ ...DEFAULT_CONTEXT, profiles: [] }, local, read),
    null,
  );
  // A pref that joined the context after Core saved it comes from this window; Core's others stay.
  const { simplifyRules: _, ...older } = DEFAULT_CONTEXT.prefs;
  const held = {
    pins: {},
    profiles: [],
    prefs: { ...older, goals: false },
  } as unknown as ProjectionContext;
  const mine = {
    ...local,
    prefs: { ...local.prefs, simplifyRules: 'Plain words' },
  };
  assert.deepEqual(migratedContext(held, mine, read)?.prefs, {
    ...DEFAULT_CONTEXT.prefs,
    goals: false,
    simplifyRules: 'Plain words',
  });
});

test('Core’s profiles are what every reader sees, the same list until they change', () => {
  assert.deepEqual(getProfiles(), DEFAULT_SPACES);
  store.setState({ context: { ...DEFAULT_CONTEXT, profiles: [stored] } });
  const first = getProfiles();
  assert.deepEqual(
    first.map((p) => p.id),
    ['side', ...DEFAULT_SPACES.map((p) => p.id)],
    'demo profiles join, unsaved',
  );
  assert.equal(getProfiles(), first);
  store.setState({ context: DEFAULT_CONTEXT });
});

test('add, rename, remove and undo keep the order and persist', () => {
  demo.isOn = false;
  store.setState({ context: { ...DEFAULT_CONTEXT, profiles: DEFAULT_SPACES } });
  const added = addProfile('Personal');
  assert.equal(added.id, 'personal-2');
  assert.notEqual(added.icon, 'home');
  updateProfile(added.id, { name: 'Weekend' });
  assert.equal(getProfiles().at(-1)!.name, 'Weekend');
  const undo = removeProfile('personal');
  assert.deepEqual(
    getProfiles().map((p) => p.id),
    ['latitude', 'liane', 'personal-2'],
  );
  undo();
  assert.deepEqual(
    getProfiles().map((p) => p.id),
    ['latitude', 'personal', 'liane', 'personal-2'],
  );
  assert.equal(store.getState().context.profiles!.length, 4);
  assert.deepEqual(storedProfiles(), getProfiles(), 'kept in storage too');
});

test('the last profile stays and the list stops at the cap', () => {
  for (const p of getProfiles().slice(1)) removeProfile(p.id);
  assert.throws(() => removeProfile(getProfiles()[0].id), /at least one/);
  while (getProfiles().length < MAX_PROFILES) addProfile('More');
  assert.throws(() => addProfile('One too many'), /up to 9/);
});

test('a copy keeps the source’s GitHub login and native choices under its own id and icon', () => {
  for (const p of getProfiles().slice(1)) removeProfile(p.id);
  const from = getProfiles()[0];
  updateProfile(from.id, {
    github: 'octo',
    nativeOff: ['claude:default:skill:user:ui'],
  });
  const copy = addProfile('Copy', getProfiles()[0]);
  assert.notEqual(copy.id, from.id);
  assert.equal(copy.github, 'octo');
  assert.deepEqual(copy.nativeOff, ['claude:default:skill:user:ui']);
  assert.equal(addProfile('Empty').github, '');
});
