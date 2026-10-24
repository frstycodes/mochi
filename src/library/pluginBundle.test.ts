import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { parsePluginBundle } from './pluginBundle.ts';

test('a plugin unpacks into skills, subagents, hooks, servers and remotes, Claude or Codex layout', () => {
  const claudePlugin = parsePluginBundle(
    'fallback',
    new Map([
      ['.claude-plugin/plugin.json', JSON.stringify({ name: 'Review Kit', version: '1.2.0', description: 'Code review helpers', agents: './reviewers/' })],
      ['skills/triage/SKILL.md', '---\nname: triage\ndescription: Sort issues\n---\nSteps'],
      ['skills/triage/notes.md', 'extra'],
      ['commands/git/commit.md', '---\ndescription: Write a commit\n---\nUse $ARGUMENTS'],
      ['agents/ignored.md', '---\nname: ignored\n---\nReplaced by the manifest path'],
      ['reviewers/security.md', '---\nname: security\ndescription: Finds vulnerabilities\nmodel: opus\n---\nBe thorough'],
      [
        'hooks/hooks.json',
        JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/fmt.sh' }] }] } }),
      ],
      ['scripts/fmt.sh', '#!/bin/sh\nprettier --write "$1"'],
      [
        '.mcp.json',
        JSON.stringify({
          mcpServers: { Linear: { type: 'http', url: 'https://mcp.linear.app/mcp' }, db: { command: 'npx', args: ['-y', 'pg-mcp'], env: { PORT: 5432 } } },
        }),
      ],
      ['.lsp.json', '{}'],
    ]),
  );

  assert.equal(claudePlugin.name, 'review-kit');
  assert.equal(claudePlugin.version, '1.2.0');
  assert.deepEqual(
    claudePlugin.skills.map((skill) => skill.name),
    ['triage', 'git-commit'],
  );
  assert.deepEqual(claudePlugin.skills[0].files, { 'notes.md': 'extra' });
  assert.deepEqual(
    claudePlugin.subagents.map((agent) => [agent.name, agent.fields.model]),
    [['security', 'opus']],
    'a manifest agents path replaces the default agents/ folder',
  );
  assert.deepEqual(claudePlugin.hooks, [
    { event: 'PostToolUse', matcher: 'Edit', handler: { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/fmt.sh' } },
  ]);
  assert.deepEqual(claudePlugin.remotes, [{ name: 'linear', url: 'https://mcp.linear.app/mcp' }]);
  assert.deepEqual(claudePlugin.servers, [{ name: 'db', command: 'npx', args: ['-y', 'pg-mcp'], env: { PORT: '5432' } }]);
  assert.equal(claudePlugin.files['scripts/fmt.sh'], '#!/bin/sh\nprettier --write "$1"');
  assert.ok(!('skills/triage/SKILL.md' in claudePlugin.files), 'component files are not duplicated as plugin files');
  assert.deepEqual(claudePlugin.unsupported, ['Language servers']);

  const codexPlugin = parsePluginBundle(
    'figma',
    new Map([
      [
        '.codex-plugin/plugin.json',
        JSON.stringify({ name: 'figma', skills: './skills/', interface: { displayName: 'Figma', shortDescription: 'Design to code' } }),
      ],
      ['skills/implement/SKILL.md', '---\nname: implement-design\ndescription: Builds UI from a frame\n---\nBody'],
      ['.app.json', JSON.stringify({ apps: { figma: { id: 'connector_123' } } })],
    ]),
  );

  assert.equal(codexPlugin.title, 'Figma');
  assert.equal(codexPlugin.description, 'Design to code');
  assert.deepEqual(
    codexPlugin.skills.map((skill) => skill.name),
    ['implement-design'],
  );
  assert.deepEqual(codexPlugin.unsupported, ['Codex apps (connectors hosted by OpenAI)']);

  const singleSkill = parsePluginBundle('solo', new Map([['SKILL.md', '---\nname: solo\ndescription: One skill\n---\nBody']]));
  assert.deepEqual(
    singleSkill.skills.map((skill) => skill.name),
    ['solo'],
  );
});
