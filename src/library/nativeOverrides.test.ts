import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProviderConfig } from '../host/types/settings.ts';
import { claudeNativeSettings, codexNativeConfig, offItems } from './nativeOverrides.ts';

const claude: ProviderConfig = {
  provider: 'claude',
  account: { id: 'claude-default', provider: 'claude', name: 'Default', configDir: null },
  instructions: { path: '', text: '' },
  mcpServers: [
    { def: { name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] }, enabled: true, scope: 'user', needs: [] },
    { def: { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp' }, enabled: true, scope: 'user', needs: [] },
    { def: { name: 'figma', type: 'http', url: 'http://127.0.0.1:3845/mcp' }, enabled: false, scope: 'user', needs: [] },
  ],
  skills: [
    { name: 'ui', description: '', dir: '/x/ui', enabled: true },
    { name: 'run', description: '', dir: '/x/run', enabled: true },
  ],
  commands: [],
  plugins: ['ponytail@ponytail'],
  projectInstructions: null,
};

const off = [
  'claude:claude-default:skill:user:ui',
  'claude:claude-default:plugin:user:ponytail@ponytail',
  'claude:claude-default:server:user:github',
  'claude:claude-default:server:user:linear',
  'claude:claude-default:server:user:figma',
  'claude:claude-work:skill:user:run',
  'claude:claude-default:skill:user:gone',
];

test('only this account’s items that still exist and the tool itself loads are left out', () => {
  assert.deepEqual(
    offItems(claude, off).map((i) => i.id),
    off.slice(0, 4),
  );
});

test('Claude gets each kind through its own flag-layer setting, servers matched by command or URL', () => {
  assert.deepEqual(claudeNativeSettings(offItems(claude, off)), {
    skillOverrides: { ui: 'off' },
    enabledPlugins: { 'ponytail@ponytail': false },
    deniedMcpServers: [{ serverCommand: ['npx', '-y', 'gh-mcp'] }, { serverUrl: 'https://mcp.linear.app/mcp' }],
  });
  assert.deepEqual(claudeNativeSettings([]), {});
});

test('Codex gets enabled = false per server and plugin, and skills.config nested', () => {
  const codex = { ...claude, provider: 'codex' as const, account: { ...claude.account, id: 'codex-default', provider: 'codex' as const } };
  const ids = off.map((id) => id.replace('claude:claude-default', 'codex:codex-default'));
  assert.deepEqual(codexNativeConfig(offItems(codex, ids)), {
    'mcp_servers.github.enabled': false,
    'mcp_servers.linear.enabled': false,
    'plugins.ponytail@ponytail.enabled': false,
    skills: { config: [{ name: 'ui', enabled: false }] },
  });
});
