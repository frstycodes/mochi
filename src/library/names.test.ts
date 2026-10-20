import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LibraryEntry } from './library.ts';
import { deslug, libraryNames } from './names.ts';

const entry = (fields: Partial<LibraryEntry> & Pick<LibraryEntry, 'kind' | 'name' | 'title'>): LibraryEntry => ({
  id: fields.name,
  description: '',
  targets: ['claude'],
  isEnabled: true,
  profileIds: [],
  source: null,
  icon: null,
  contents: null,
  remotes: [],
  unsupported: [],
  isLinked: null,
  alias: null,
  autoUpdate: null,
  updatedAt: null,
  commit: null,
  placements: [],
  ...fields,
});

const names = libraryNames([
  entry({ kind: 'plugin', name: 'superpowers', title: 'Superpowers', icon: 'https://avatars/obra.png' }),
  entry({ kind: 'skill', name: 'pdf', title: 'pdf', icon: 'https://avatars/anthropics.png' }),
  entry({ kind: 'connector', name: 'slack:work', title: 'Slack · work', source: 'https://mcp.slack.com/mcp', icon: 'https://slack.com/favicon.ico', alias: 'work' }),
  entry({ kind: 'connector', name: 'mcp-acme-dev:me', title: 'Acme · me', source: 'https://mcp.acme.dev/mcp', alias: 'me' }),
]);

test('connectors read by their service name and icon, whatever the session called the server', () => {
  assert.deepEqual(names.server('slack'), { title: 'Slack', raw: 'slack', url: 'https://mcp.slack.com/mcp', image: 'https://slack.com/favicon.ico' });
  assert.equal(names.server('mcp-acme-dev').title, 'Acme');
  assert.equal(names.server('linear').title, 'Linear');
  assert.ok(names.server('linear').image);
  assert.equal(names.server('mochi').title, 'Mochi');
  assert.equal(names.server('claude.ai Gmail').title, 'claude.ai Gmail');
  assert.equal(names.server('my-files').title, 'My files');
});

test("a plugin's own servers and skills take the plugin's title and icon", () => {
  assert.deepEqual(names.server('plugin:superpowers:docs'), { title: 'Superpowers', raw: 'plugin:superpowers:docs', image: 'https://avatars/obra.png' });
  assert.deepEqual(names.skill('superpowers:brainstorming'), { title: 'Brainstorming', raw: 'superpowers:brainstorming', image: 'https://avatars/obra.png' });
  assert.equal(names.plugin('unknown-plugin').title, 'Unknown plugin');
});

test('standalone skills load as mochi:<skill> and read as their own name', () => {
  assert.deepEqual(names.skill('mochi:pdf'), { title: 'Pdf', raw: 'mochi:pdf', image: 'https://avatars/anthropics.png' });
  assert.deepEqual(names.skill('frontend-design'), { title: 'Frontend design', raw: 'frontend-design' });
});

test('tools read as words, without the server name they repeat', () => {
  assert.equal(names.tool('slack', 'slack_search_messages'), 'Search messages');
  assert.equal(names.tool('google-workspace', 'search_gmail_messages'), 'Search gmail messages');
  assert.equal(names.tool('linear', 'linear'), 'Linear');
  assert.equal(names.call('slack', 'slack_search_messages', 'work'), 'search messages on Slack (work)');
  assert.equal(names.call('linear', 'get_issue'), 'get issue on Linear');
});

test('deslug', () => {
  assert.equal(deslug('google-workspace'), 'Google workspace');
  assert.equal(deslug('getIssue'), 'Get issue');
  assert.equal(deslug('--'), '--');
});
