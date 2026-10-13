import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type ProfileConfig, type ProviderConfig } from '../host/types/settings.ts';
import { DEFAULT_SPACES, type Provider } from '../model.ts';
import { DEFAULT_ACCOUNTS } from './accounts.ts';
import { settingsCatalog, type SettingSources } from './catalog.ts';
import { DEFAULT_PREFS } from './prefs.ts';

const providerConfig = (provider: Provider): ProviderConfig => ({
  provider,
  account: DEFAULT_ACCOUNTS.find((a) => a.provider === provider)!,
  instructions: { path: `/x/${provider}.md`, text: 'Be brief.\n' },
  mcpServers: [{ def: { name: 'github', type: 'stdio', command: 'npx' }, enabled: true, scope: 'user', needs: [] }],
  skills: [{ name: 'review', description: '', dir: '/x/review', enabled: false }],
  plugins: [],
  projectInstructions: null,
});

const config: ProfileConfig = { claude: providerConfig('claude'), codex: providerConfig('codex') };

const sources: SettingSources = {
  prefs: DEFAULT_PREFS,
  theme: 'system',
  quiet: { isOn: false, start: 22, end: 8 },
  host: DEFAULT_SETTINGS,
  profile: DEFAULT_SPACES[0],
  accounts: { accounts: DEFAULT_ACCOUNTS, links: {} },
  config,
};

test('every setting reads its default and takes that value back', () => {
  const catalog = settingsCatalog({ profile: DEFAULT_SPACES[0], config });
  assert.equal(new Set(catalog.map((s) => s.key)).size, catalog.length, 'keys are unique');
  for (const setting of catalog) {
    const value = setting.read(sources);
    assert.notEqual(value, undefined, `${setting.key} reads`);
    assert.ok(setting.write(value!, sources), `${setting.key} takes its own value ${JSON.stringify(value)}`);
  }
});

test('writes land where the setting lives, and a value outside the control is refused', () => {
  const catalog = settingsCatalog({ profile: DEFAULT_SPACES[0], config });
  const write = (key: string, value: string) => catalog.find((s) => s.key === key)!.write(value, sources);
  assert.deepEqual(write('alert.review', 'false'), { to: 'prefs', patch: { alertKinds: DEFAULT_PREFS.alertKinds.filter((k) => k !== 'review') } });
  assert.deepEqual(write('dockBadge', 'off'), { to: 'prefs', patch: { dockBadge: false } });
  assert.deepEqual(write('concurrency', '8'), { to: 'host', patch: { concurrency: 8 } });
  assert.deepEqual(write('projectsFolder', ' '), { to: 'prefs', patch: { projectsFolder: DEFAULT_PREFS.projectsFolder } }, 'emptied falls back');
  assert.deepEqual(write('quietFrom', '23'), { to: 'quiet', patch: { start: 23 } });
  assert.deepEqual(write('profile.codex.skill.review', 'true'), {
    to: 'config',
    title: 'Turn on review',
    changes: [{ kind: 'skill-enabled', provider: 'codex', name: 'review', enabled: true }],
  });
  assert.equal(write('concurrency', '99'), null);
  assert.equal(write('theme', 'sepia'), null);
  assert.equal(write('profile.name', '  '), null);
  assert.equal(write('profile.claudeAccount', 'codex-default'), null, 'another harness’s account');
});
