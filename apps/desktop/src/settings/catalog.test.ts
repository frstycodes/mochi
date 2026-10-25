import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  DEFAULT_SETTINGS,
  type ProfileConfig,
  type ProviderConfig,
} from '../host/types/settings.ts';
import { DEFAULT_SPACES, type Provider } from '../model.ts';
import { DEFAULT_ACCOUNTS } from './accounts.ts';
import { settingsCatalog, type SettingSources } from './catalog.ts';
import { DEFAULT_PREFS } from './prefs.ts';

const providerConfig = (provider: Provider): ProviderConfig => ({
  provider,
  account: DEFAULT_ACCOUNTS.find((a) => a.provider === provider)!,
  instructions: { path: `/x/${provider}.md`, text: 'Be brief.\n' },
  mcpServers: [
    {
      def: { name: 'github', type: 'stdio', command: 'npx' },
      enabled: true,
      scope: 'user',
      needs: [],
    },
  ],
  skills: [
    { name: 'review', description: '', dir: '/x/review', enabled: false },
  ],
  commands: [],
  plugins: [],
  projectInstructions: null,
});

const config: ProfileConfig = {
  claude: providerConfig('claude'),
  codex: providerConfig('codex'),
};

const sources: SettingSources = {
  prefs: DEFAULT_PREFS,
  theme: 'system',
  quiet: { isOn: false, start: 22, end: 8 },
  host: DEFAULT_SETTINGS,
  profile: DEFAULT_SPACES[0],
  accounts: { accounts: DEFAULT_ACCOUNTS, links: {} },
  config,
  colorThemes: [{ id: 'ext:a.b:Night', label: 'Night', kind: 'dark' }],
  remote: {
    isEnabled: false,
    allowsNetwork: false,
    machineName: '',
    reachesAnywhere: false,
    keepsAwake: true,
  },
};

test('every setting reads its default and takes that value back', () => {
  const catalog = settingsCatalog({ profile: DEFAULT_SPACES[0], config });
  assert.equal(
    new Set(catalog.map((s) => s.key)).size,
    catalog.length,
    'keys are unique',
  );
  for (const setting of catalog) {
    const value = setting.read(sources);
    assert.notEqual(value, undefined, `${setting.key} reads`);
    assert.ok(
      setting.write(value!, sources),
      `${setting.key} takes its own value ${JSON.stringify(value)}`,
    );
  }
});

test('writes land where the setting lives, and a value outside the control is refused', () => {
  const catalog = settingsCatalog({ profile: DEFAULT_SPACES[0], config });
  const write = (key: string, value: string) =>
    catalog.find((s) => s.key === key)!.write(value, sources);
  assert.deepEqual(write('alert.ci', 'false'), {
    to: 'prefs',
    patch: { alertKinds: DEFAULT_PREFS.alertKinds.filter((k) => k !== 'ci') },
  });
  assert.deepEqual(write('dockBadge', 'off'), {
    to: 'prefs',
    patch: { dockBadge: false },
  });
  assert.deepEqual(write('concurrency', '8'), {
    to: 'host',
    patch: { concurrency: 8 },
  });
  assert.deepEqual(
    write('projectsFolder', ' '),
    { to: 'prefs', patch: { projectsFolder: DEFAULT_PREFS.projectsFolder } },
    'emptied falls back',
  );
  assert.deepEqual(write('quietFrom', '23'), {
    to: 'quiet',
    patch: { start: 23 },
  });
  assert.deepEqual(write('profile.codex.skill.review', 'true'), {
    to: 'config',
    title: 'Turn on review',
    changes: [
      {
        kind: 'skill-enabled',
        provider: 'codex',
        name: 'review',
        enabled: true,
      },
    ],
  });
  assert.equal(write('concurrency', '99'), null);
  assert.equal(write('theme', 'sepia'), null);
  assert.deepEqual(write('darkTheme', 'ext:a.b:Night'), {
    to: 'prefs',
    patch: { darkTheme: 'ext:a.b:Night' },
  });
  assert.equal(
    write('lightTheme', 'ext:a.b:Night'),
    null,
    'a dark theme in the light slot',
  );
  assert.deepEqual(write('utility.commit', 'codex:gpt-6-luna'), {
    to: 'host',
    patch: {
      utilityModels: { commit: { provider: 'codex', model: 'gpt-6-luna' } },
    },
  });
  assert.deepEqual(write('machineName', 'studio'), {
    to: 'remote',
    patch: { machineName: 'studio' },
  });
  assert.equal(write('profile.name', '  '), null);
  assert.equal(
    write('profile.claudeAccount', 'codex-default'),
    null,
    'another harness’s account',
  );
});

test("a shortcut row reads the chord now and writes it the widget's way: a clash loses its shortcut, a reserved chord is no value", () => {
  const row = settingsCatalog().find((s) => s.key === 'keybinding.palette')!;
  assert.equal(row.read(sources), 'mod+K');
  assert.deepEqual(row.write('mod+P', sources), {
    to: 'prefs',
    patch: { keybindings: { palette: 'mod+P', 'files-go-to': '' } },
  });
  assert.deepEqual(row.write('', sources), {
    to: 'prefs',
    patch: { keybindings: { palette: '' } },
  });
  assert.equal(row.write('mod+C', sources), null);
  assert.equal(row.write('cmd+K', sources), null);
});

test('every app setting sits in a titled group on its page; profile settings group by profile instead', () => {
  for (const setting of settingsCatalog({
    profile: DEFAULT_SPACES[0],
    config,
  })) {
    if (setting.section === 'profile')
      assert.equal(setting.group, undefined, setting.key);
    else assert.ok(setting.group, `${setting.key} has a group`);
  }
});

test('animations start off; an area switch sets all of its animations, each switch only its own', () => {
  const catalog = settingsCatalog({ profile: DEFAULT_SPACES[0], config });
  const find = (key: string) => catalog.find((s) => s.key === key)!;
  assert.equal(find('animations.sidebar').read(sources), 'false');
  assert.equal(find('animation.pane-slide').read(sources), 'false');
  const someOn = {
    ...sources,
    prefs: { ...DEFAULT_PREFS, animations: ['sidebar-peek', 'pane-slide'] },
  };
  assert.equal(
    find('animations.sidebar').read(someOn),
    'true',
    'on while any is',
  );
  assert.deepEqual(find('animations.sidebar').write('false', someOn), {
    to: 'prefs',
    patch: { animations: ['pane-slide'] },
  });
  assert.deepEqual(find('animations.pane').write('true', someOn), {
    to: 'prefs',
    patch: {
      animations: ['sidebar-peek', 'pane-slide', 'pane-pop', 'pane-layout'],
    },
  });
  assert.deepEqual(find('animation.sidebar-toggle').write('true', someOn), {
    to: 'prefs',
    patch: { animations: ['sidebar-peek', 'pane-slide', 'sidebar-toggle'] },
  });
  assert.equal(find('animation.sidebar-toggle').write('maybe', someOn), null);
});
