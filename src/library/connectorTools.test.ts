import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudePermissions, codexToolConfig, connectorName, setAllTools, toolRules, type ConnectorSettings, type ConnectorTool } from './connectorTools.ts';
import { profileConnectors, type LibraryIndex } from './library.ts';

const tool = (name: string, isReadOnly: boolean): ConnectorTool => ({ name, title: null, description: '', isReadOnly, isDestructive: !isReadOnly });
const listed: ConnectorSettings = { toolList: { tools: [tool('list_issues', true), tool('create_issue', false), tool('delete_comment', false)], listedAt: 1, error: null } };

test('a connector is named by you, else the directory, else its server, else its host', () => {
  assert.equal(connectorName('https://mcp.example.com/mcp', ' Acme  '), 'Acme');
  assert.equal(connectorName('https://mcp.linear.app/mcp', '', { name: 'linear-mcp' }), 'Linear');
  assert.equal(connectorName('https://mcp.example.com/mcp', undefined, { name: 'acme-server', title: 'Acme Tracker' }), 'Acme Tracker');
  assert.equal(connectorName('https://mcp.example.com/mcp', undefined, { name: 'acme-server' }), 'acme-server');
  assert.equal(connectorName('https://mcp.example.com/mcp', '   ', { name: ' ' }), 'mcp.example.com');
});

test('read-only tools allow and the rest ask by default; your choices and set-all win in that order', () => {
  assert.deepEqual(toolRules(listed), { allow: ['list_issues'], ask: ['create_issue', 'delete_comment'], off: [] });
  const chosen = { ...listed, permission: 'allow' as const, tools: { delete_comment: 'off' as const, list_issues: 'ask' as const, gone_tool: 'allow' as const } };
  assert.deepEqual(toolRules(chosen), { allow: ['create_issue', 'gone_tool'], ask: ['list_issues'], off: ['delete_comment'] });
  assert.deepEqual(toolRules(setAllTools(chosen, 'ask')), { allow: [], ask: ['list_issues', 'create_issue'], off: ['delete_comment'] });
  assert.deepEqual(toolRules({ ...chosen, isOff: true }), { allow: [], ask: [], off: [] });
  assert.deepEqual(toolRules(undefined), { allow: [], ask: [], off: [] });
});

test('Claude gets allow / ask / deny rules as mcp__<server>__<tool>', () => {
  const rules = { linear: toolRules({ ...listed, tools: { delete_comment: 'off' } }), 'google-workspace': { allow: ['search.mail'], ask: [], off: [] } };
  assert.deepEqual(claudePermissions(rules), {
    allow: ['mcp__linear__list_issues', 'mcp__google-workspace__search_mail'],
    ask: ['mcp__linear__create_issue'],
    deny: ['mcp__linear__delete_comment'],
  });
});

test('Codex gets disabled_tools and a tools table of approve / prompt', () => {
  assert.deepEqual(codexToolConfig('linear', toolRules({ ...listed, tools: { delete_comment: 'off' } })), {
    'mcp_servers.linear.disabled_tools': ['delete_comment'],
    'mcp_servers.linear.tools': { list_issues: { approval_mode: 'approve' }, create_issue: { approval_mode: 'prompt' } },
  });
  assert.deepEqual(codexToolConfig('linear', { allow: [], ask: [], off: [] }), {});
});

test('a connector that is off reaches no session', () => {
  const account = { kind: 'connector' as const, id: 'a', key: 'linear', title: 'Linear', url: 'https://mcp.linear.app/mcp', alias: 'work', isLinked: true, targets: ['claude' as const], addedAt: 1 };
  const index: LibraryIndex = { items: [account], profiles: { p: ['a'] }, marketplaces: [], connectors: { linear: { isOff: true } } };
  assert.equal(profileConnectors(index, 'p').size, 0);
  assert.equal(profileConnectors({ ...index, connectors: {} }, 'p').size, 1);
});
