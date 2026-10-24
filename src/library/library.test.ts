import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePluginBundle } from './pluginBundle.ts';
import { codexServerConfig, EMPTY_LIBRARY, libraryEntries, ownSkillItem, parseLibrary, profileConnectors, profileLayout, removeItem, setItemEnabled, STANDALONE_PLUGIN, type LibraryIndex } from './library.ts';

const library: LibraryIndex = {
  items: [
    { kind: 'skill', id: 's1', name: 'pdf', description: 'Read PDFs', files: { 'SKILL.md': '---\nname: pdf\n---\nRead it.', 'ref/a.md': 'A' }, targets: ['claude', 'codex'], addedAt: 1, source: null, icon: null },
    { kind: 'skill', id: 's2', name: 'codex-only', description: '', files: { 'SKILL.md': 'x' }, targets: ['codex'], addedAt: 1, source: null, icon: null },
    { kind: 'server', id: 'm1', def: { name: 'files', type: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } }, targets: ['claude', 'codex'], addedAt: 1 },
  ],
  profiles: { work: ['s1', 's2', 'm1'], home: [] },
  marketplaces: [],
};

test('a profile loads only what it turned on, for the harness each item targets', () => {
  const claude = profileLayout(library, 'work', 'claude');
  assert.deepEqual(Object.keys(claude.plugins), [STANDALONE_PLUGIN]);
  const files = claude.plugins[STANDALONE_PLUGIN];
  assert.equal(files['skills/pdf/ref/a.md'], 'A');
  assert.equal(JSON.parse(files['.claude-plugin/plugin.json']).name, STANDALONE_PLUGIN);
  assert.ok(!Object.keys(files).some((path) => path.includes('codex-only')));
  assert.deepEqual(claude.servers.map((s) => s.name), ['files']);

  assert.deepEqual(profileLayout(library, 'work', 'codex').plugins, {});
  const sourced = { ...library, items: library.items.map((i) => (i.kind === 'skill' && i.id === 's1' ? { ...i, source: 'EmilKowalski/skills/pdf' } : i)) };
  const owned = profileLayout(sourced, 'work', 'claude').plugins;
  assert.ok(owned.emilkowalski?.['skills/pdf/ref/a.md'], 'a GitHub skill loads under its owner, so / reads /emilkowalski:pdf');
  assert.equal(JSON.parse(owned.emilkowalski['.claude-plugin/plugin.json']).name, 'emilkowalski');
  assert.deepEqual(profileLayout(library, 'home', 'claude'), { plugins: {}, servers: [] });
  assert.deepEqual(profileLayout(library, 'unknown', 'claude'), { plugins: {}, servers: [] });
});

test('a plugin is rebuilt as its own Claude plugin folder, with remotes and auto-loaded files left out', () => {
  const bundle = parsePluginBundle('kit', new Map([
    ['.claude-plugin/plugin.json', JSON.stringify({ name: 'kit', version: '1.0.0' })],
    ['skills/triage/SKILL.md', '---\nname: triage\ndescription: Sort: issues\n---\nSteps'],
    ['commands/ship.md', 'Ship it'],
    ['agents/rev.md', '---\nname: rev\nmodel: opus\n---\nReview'],
    ['hooks/hooks.json', JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/hooks/fmt.sh' }] }] } })],
    ['hooks/fmt.sh', '#!/bin/sh'],
    ['.mcp.json', JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' }, db: { command: 'npx', args: ['pg'] }, local: { command: '${CLAUDE_PLUGIN_ROOT}/bin/srv' } } })],
    ['output-styles/terse.md', 'x'],
  ]));
  const index: LibraryIndex = { items: [{ kind: 'plugin', id: 'p1', bundle, marketplace: 'm', icon: null, targets: ['claude', 'codex'], addedAt: 1 }], profiles: { work: ['p1'] }, marketplaces: [] };
  const files = profileLayout(index, 'work', 'claude').plugins.kit;
  assert.deepEqual(Object.keys(files).sort(), ['.claude-plugin/plugin.json', '.mcp.json', 'agents/rev.md', 'hooks/fmt.sh', 'hooks/hooks.json', 'skills/ship/SKILL.md', 'skills/triage/SKILL.md']);
  assert.deepEqual(Object.keys(JSON.parse(files['.mcp.json']).mcpServers), ['db', 'local']);
  assert.match(files['skills/triage/SKILL.md'], /^description: "Sort: issues"$/m);
  assert.match(files['agents/rev.md'], /^model: "opus"$/m);
  assert.equal(JSON.parse(files['hooks/hooks.json']).hooks.PostToolUse[0].matcher, 'Edit');
  assert.deepEqual(profileLayout(index, 'work', 'codex').servers.map((s) => s.name), ['db']);
  assert.equal(libraryEntries(index, 'work')[0].contents, '2 skills · 1 agent · 1 hook · 2 servers');
  assert.equal(libraryEntries({ ...index, items: [{ ...index.items[0], bundle: { ...bundle, skills: [], subagents: [], hooks: [], servers: [] } }] as LibraryIndex['items'] }, 'work')[0].contents, null);
  assert.deepEqual(libraryEntries(index, 'work')[0].remotes, [{ name: 'linear', url: 'https://mcp.linear.app/mcp' }]);
});

test('membership toggles per profile and removal clears it everywhere', () => {
  const on = setItemEnabled(library, 'home', 'm1', true);
  assert.deepEqual(libraryEntries(on, 'home').find((e) => e.id === 'm1')?.profileIds, ['work', 'home']);
  assert.deepEqual(libraryEntries(on, 'home').filter((e) => e.isEnabled).map((e) => e.name), ['files']);
  assert.deepEqual(setItemEnabled(on, 'home', 'm1', false).profiles.home, []);
  assert.throws(() => setItemEnabled(library, 'home', 'nope', true));
  const removed = removeItem(on, 'm1');
  assert.ok(!removed.items.some((i) => i.id === 'm1'));
  assert.ok(!Object.values(removed.profiles).flat().includes('m1'));
});

test('Codex gets servers as dotted config overrides', () => {
  assert.deepEqual(codexServerConfig([{ name: 'files', type: 'stdio', command: 'npx', args: ['-y', 'fs'], env: { ROOT: '/tmp' } }, { name: 'web', type: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }]), {
    'mcp_servers.files.command': 'npx',
    'mcp_servers.files.args': ['-y', 'fs'],
    'mcp_servers.files.env.ROOT': '/tmp',
    'mcp_servers.web.url': 'https://x/mcp',
    'mcp_servers.web.http_headers.Authorization': 'Bearer t',
  });
});

test('parseLibrary falls back to an empty library and drops unknown kinds', () => {
  assert.deepEqual(parseLibrary(null), EMPTY_LIBRARY);
  assert.deepEqual(parseLibrary('{"items":5}'), EMPTY_LIBRARY);
  assert.deepEqual(parseLibrary(JSON.stringify({ items: [...library.items, { kind: 'mystery' }], profiles: {} })).items.length, 3);
});

test('a profile reaches only its own signed-in connector accounts, grouped by server', () => {
  const account = (id: string, key: string, alias: string, isLinked = true) => ({ kind: 'connector' as const, id, key, title: key, url: `https://${key}.example/mcp`, alias, isLinked, targets: ['claude' as const, 'codex' as const], addedAt: 1 });
  const index: LibraryIndex = {
    items: [account('a', 'linear', 'work'), account('b', 'linear', 'personal'), account('c', 'notion', 'work', false), account('d', 'linear', 'other')],
    profiles: { work: ['a', 'b', 'c'] },
    marketplaces: [],
  };
  const groups = profileConnectors(index, 'work');
  assert.deepEqual([...groups.keys()], ['linear']);
  assert.deepEqual(groups.get('linear')?.map((a) => a.alias), ['work', 'personal']);
  assert.equal(libraryEntries(index, 'work')[2].isLinked, false);
  assert.equal(libraryEntries(index, 'work')[0].title, 'linear · work');
});

test('a skill written or uploaded in Mochi needs a named SKILL.md and stays inside its folder', () => {
  const md = '---\nname: Release-Notes\ndescription: "From merged PRs"\n---\n\nList the PRs.';
  const item = ownSkillItem({ 'SKILL.md': md, 'ref/style.md': 'x' }, 'id1', 5);
  assert.deepEqual([item.name, item.description, item.source, item.targets], ['release-notes', 'From merged PRs', null, ['claude', 'codex']]);
  assert.throws(() => ownSkillItem({ 'notes.md': md }, 'id', 0), /needs a SKILL\.md/);
  assert.throws(() => ownSkillItem({ 'SKILL.md': md, '../escape.md': 'x' }, 'id', 0), /isn't a path inside/);
  assert.throws(() => ownSkillItem({ 'SKILL.md': md, '/abs.md': 'x' }, 'id', 0), /isn't a path inside/);
  assert.throws(() => ownSkillItem({ 'SKILL.md': '---\ndescription: x\n---\n\nBody' }, 'id', 0), /needs a name/);
  assert.throws(() => ownSkillItem({ 'SKILL.md': '---\nname: x\n---\n' }, 'id', 0), /no instructions/);
});
