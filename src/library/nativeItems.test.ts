import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ProviderConfig } from '../host/types/settings.ts';
import { nativeItemsOf, withOff } from './nativeItems.ts';

const config: ProviderConfig = {
  provider: 'claude',
  account: { id: 'claude-work', provider: 'claude', name: 'Work', configDir: '/Users/me/.claude-work' },
  instructions: { path: '', text: '' },
  mcpServers: [
    { def: { name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] }, enabled: true, scope: 'user', needs: ['GITHUB_TOKEN'] },
    { def: { name: 'github', type: 'http', url: 'https://example.com/mcp' }, enabled: false, scope: 'project', needs: [] },
  ],
  skills: [{ name: 'ui', description: 'UI work', dir: '/Users/me/.claude-work/skills/ui', enabled: true }],
  commands: [],
  plugins: ['ponytail'],
  projectInstructions: null,
};

test('native items get stable ids that keep a project server apart from a user one of the same name', () => {
  const items = nativeItemsOf(config);
  assert.deepEqual(
    items.map((i) => i.id),
    ['claude:claude-work:skill:user:ui', 'claude:claude-work:plugin:user:ponytail', 'claude:claude-work:server:user:github', 'claude:claude-work:server:project:github'],
  );
  assert.deepEqual(nativeItemsOf(config).map((i) => i.id), items.map((i) => i.id));
});

test('native items carry where they live, what stops them, and whether the tool itself has them off', () => {
  const [skill, , user, project] = nativeItemsOf(config);
  assert.equal(skill.where, '~/.claude-work/skills/ui');
  assert.equal(user.where, '~/.claude-work/.claude.json · stdio · npx -y gh-mcp');
  assert.equal(user.problem, 'Needs GITHUB_TOKEN set to start');
  assert.equal(project.where, 'Project · .mcp.json · http · https://example.com/mcp');
  assert.equal(project.isOffNatively, true);
});

test('withOff adds each id once and takes ids out', () => {
  assert.deepEqual(withOff(['a'], ['a', 'b'], true), ['a', 'b']);
  assert.deepEqual(withOff(['a', 'b', 'c'], ['a', 'c'], false), ['b']);
  assert.deepEqual(withOff(undefined, ['a'], true), ['a']);
});
