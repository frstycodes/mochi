import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  claudePluginRoots,
  commandMeta,
  claudeDeniedServers,
  claudeServers,
  claudeSkillOff,
  codexServers,
  codexSkillOverrides,
  isSecret,
  parseServerCommand,
  parseServerJson,
  placeholders,
  removeClaudeServer,
  removeCodexServer,
  setClaudeServer,
  setClaudeServerEnabled,
  setClaudeSkillEnabled,
  setCodexServer,
  setCodexServerEnabled,
  setCodexSkillEnabled,
  skillMeta,
  stripSecrets,
  type McpServerDef,
} from './agentConfig.ts';
import { parseToml } from './toml.ts';

// Shaped like the files Claude Code 2.1.296 and codex-cli 0.155.1 wrote for `mcp add` in a scratch config folder.
const CLAUDE_JSON = `{
  "oauthAccount": { "accountUuid": "u-1" },
  "mcpServers": {
    "probe": { "type": "stdio", "command": "echo", "args": ["x"], "env": { "API_TOKEN": "abc" } },
    "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }
  }
}
`;

const CODEX_TOML = `model = "gpt-5.5" # keep me

[mcp_servers.probe]
command = "echo"
args = ["x"]

[mcp_servers.probe.env]
API_TOKEN = "abc"

[mcp_servers."dotted.name"]
url = "https://example.com/mcp"
bearer_token_env_var = "EXAMPLE_TOKEN"
env_vars = [
  "HOME", # trailing comment
]
enabled = false

[[skills.config]]
path = "/u/.codex/skills/old/SKILL.md"
enabled = false

[notice]
hide = true
`;

test('Claude: reads user servers and keeps the rest of .claude.json when writing', () => {
  assert.deepEqual(claudeServers(CLAUDE_JSON), [
    {
      name: 'probe',
      type: 'stdio',
      command: 'echo',
      args: ['x'],
      env: { API_TOKEN: 'abc' },
    },
    { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp' },
  ]);
  const added = setClaudeServer(CLAUDE_JSON, {
    name: 'fs',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'fs-mcp'],
  });
  assert.deepEqual(JSON.parse(added).oauthAccount, { accountUuid: 'u-1' });
  assert.deepEqual(JSON.parse(added).mcpServers.fs, {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'fs-mcp'],
  });
  assert.deepEqual(
    Object.keys(JSON.parse(removeClaudeServer(added, 'probe')).mcpServers),
    ['linear', 'fs'],
  );
  assert.deepEqual(claudeServers(''), []);
  assert.throws(
    () => claudeServers('{ nope'),
    /\.claude\.json isn't valid JSON/,
  );
});

test('Claude: servers and skills turn off through settings.json, other entries untouched', () => {
  const settings = JSON.stringify({
    model: 'opus',
    deniedMcpServers: [{ serverUrl: 'https://x/*' }],
  });
  const off = setClaudeServerEnabled(settings, 'probe', false);
  assert.deepEqual(JSON.parse(off).deniedMcpServers, [
    { serverUrl: 'https://x/*' },
    { serverName: 'probe' },
  ]);
  assert.deepEqual([...claudeDeniedServers(off)], ['probe']);
  assert.deepEqual(
    JSON.parse(setClaudeServerEnabled(off, 'probe', true)),
    JSON.parse(settings),
  );
  assert.deepEqual(JSON.parse(setClaudeServerEnabled('', 'a', true)), {});

  const skillOff = setClaudeSkillEnabled(settings, 'run', false);
  assert.deepEqual([...claudeSkillOff(skillOff)], ['run']);
  assert.equal(
    JSON.parse(setClaudeSkillEnabled(skillOff, 'run', true)).skillOverrides,
    undefined,
  );
  assert.deepEqual(
    [
      ...claudeSkillOff(
        JSON.stringify({ skillOverrides: { a: 'name-only', b: 'off' } }),
      ),
    ],
    ['b'],
  );
});

test('TOML: reads values, quoted and dotted headers, arrays of tables, multi-line strings', () => {
  const { doc, tables } = parseToml(
    `a = """\nline\n"""\nb = 'raw\\n'\nc = { d = [1, 2], "e f" = true }\nt.u = 3\n${CODEX_TOML}`,
  );
  assert.equal(doc.a, 'line\n');
  assert.equal(doc.b, 'raw\\n');
  assert.deepEqual(doc.c, { d: [1, 2], 'e f': true });
  assert.deepEqual(doc.t, { u: 3 });
  assert.deepEqual(
    tables.map((t) => t.path.join('.')),
    [
      'mcp_servers.probe',
      'mcp_servers.probe.env',
      'mcp_servers.dotted.name',
      'skills.config',
      'notice',
    ],
  );
  assert.throws(() => parseToml('a = "open'), /config.toml line 1:/);
});

test('Codex: reads servers, translating pass-through variables to ${VAR}', () => {
  assert.deepEqual(codexServers(CODEX_TOML), [
    {
      def: {
        name: 'probe',
        type: 'stdio',
        command: 'echo',
        args: ['x'],
        env: { API_TOKEN: 'abc' },
      },
      enabled: true,
    },
    {
      def: {
        name: 'dotted.name',
        type: 'http',
        url: 'https://example.com/mcp',
        env: { HOME: '${HOME}' },
        headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}' },
      },
      enabled: false,
    },
  ]);
});

test('Codex: writes one server in place, leaving comments and other tables alone', () => {
  const def: McpServerDef = {
    name: 'probe',
    type: 'stdio',
    command: 'npx',
    args: ['probe'],
    env: { TOKEN: '${TOKEN}', MODE: 'fast' },
  };
  const next = setCodexServer(CODEX_TOML, def);
  assert.match(next, /^model = "gpt-5.5" # keep me\n/);
  assert.match(
    next,
    /\[mcp_servers\.probe\]\ncommand = "npx"\nargs = \["probe"\]\nenv_vars = \["TOKEN"\]\n\n\[mcp_servers\.probe\.env\]\nMODE = "fast"\n/,
  );
  assert.doesNotMatch(next, /API_TOKEN/);
  assert.deepEqual(codexServers(next)[0].def, def);
  assert.match(next, /\[notice\]\nhide = true\n$/);

  const disabled = setCodexServerEnabled(next, 'probe', false);
  assert.equal(codexServers(disabled)[0].enabled, false);
  assert.equal(
    codexServers(setCodexServerEnabled(disabled, 'probe', true))[0].enabled,
    true,
  );
  // Replacing a disabled server keeps it disabled.
  assert.equal(codexServers(setCodexServer(disabled, def))[0].enabled, false);

  const removed = removeCodexServer(CODEX_TOML, 'probe');
  assert.deepEqual(
    codexServers(removed).map((s) => s.def.name),
    ['dotted.name'],
  );
  assert.match(
    removed,
    /^model = "gpt-5.5" # keep me\n\n\[mcp_servers\."dotted\.name"\]/,
  );

  const fresh = setCodexServer('', {
    name: 'remote',
    type: 'http',
    url: 'https://r/mcp',
    headers: {
      Authorization: 'Bearer ${R_TOKEN}',
      'X-Team': '${TEAM}',
      Accept: 'json',
    },
  });
  assert.equal(
    fresh,
    '[mcp_servers.remote]\nurl = "https://r/mcp"\nbearer_token_env_var = "R_TOKEN"\nenv_http_headers = { X-Team = "TEAM" }\nhttp_headers = { Accept = "json" }\n',
  );
  assert.deepEqual(codexServers(fresh)[0].def.headers, {
    Accept: 'json',
    'X-Team': '${TEAM}',
    Authorization: 'Bearer ${R_TOKEN}',
  });
});

test('Codex: skills turn off with a [[skills.config]] entry and back on by dropping it', () => {
  const path = '/u/.codex/skills/new/SKILL.md';
  const off = setCodexSkillEnabled(CODEX_TOML, path, false);
  assert.deepEqual(
    [...codexSkillOverrides(off)],
    [
      ['/u/.codex/skills/old/SKILL.md', false],
      [path, false],
    ],
  );
  const back = setCodexSkillEnabled(off, '/u/.codex/skills/old/SKILL.md', true);
  assert.deepEqual([...codexSkillOverrides(back)], [[path, false]]);
  assert.match(back, /\[notice\]\nhide = true\n/);
  assert.equal(setCodexSkillEnabled(CODEX_TOML, path, true), CODEX_TOML);
});

test('secrets: recognised by name, by token prefix and by randomness; paths, URLs and placeholders are not', () => {
  for (const [k, v] of [
    ['API_TOKEN', 'abc'],
    ['GITHUB_PERSONAL_ACCESS_TOKEN', 'x'],
    ['DB_PASSWORD', 'hunter2'],
    ['OPENAI_KEY', 'whatever'],
    ['ANYTHING', 'sk-ant-api03-abcdefghijkl'],
    ['ANYTHING', 'ghp_abcdefghijklmnop1234'],
    ['ANYTHING', 'f3a9c1d27b5e4f60a8c3d9e1b2f4a6c8d0e2f4a6'],
    ['Authorization', 'Bearer abc'],
  ])
    assert.equal(isSecret(k, v), true, `${k}=${v}`);
  for (const [k, v] of [
    ['NODE_ENV', 'production'],
    ['PORT', '3000'],
    ['KEY_FILE', '/Users/me/.ssh/id'],
    ['API_TOKEN', '${API_TOKEN}'],
    ['BASE_URL', 'https://api.example.com/v1'],
    ['DEBUG', 'true'],
  ])
    assert.equal(isSecret(k, v), false, `${k}=${v}`);
});

test('secrets: stripped to ${VAR} in env, headers, args and URLs, and reported', () => {
  const { def, stripped } = stripSecrets({
    name: 'git-hub',
    type: 'stdio',
    command: 'npx',
    args: [
      'server',
      '--api-key',
      'sk-live-abcdefghijk',
      '--token=xyz',
      '--verbose',
    ],
    env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnop1234', LOG_LEVEL: 'debug' },
  });
  assert.deepEqual(def.env, {
    GITHUB_TOKEN: '${GITHUB_TOKEN}',
    LOG_LEVEL: 'debug',
  });
  assert.deepEqual(def.args, [
    'server',
    '--api-key',
    '${GIT_HUB_API_KEY}',
    '--token=${GIT_HUB_TOKEN}',
    '--verbose',
  ]);
  assert.deepEqual(stripped, [
    'GITHUB_TOKEN',
    'GIT_HUB_API_KEY',
    'GIT_HUB_TOKEN',
  ]);

  const remote = stripSecrets({
    name: 'r',
    type: 'http',
    url: 'https://r.dev/mcp?token=abc123&team=core',
    headers: { Authorization: 'Bearer abc', Accept: 'json' },
  });
  assert.equal(remote.def.url, 'https://r.dev/mcp?token=${R_TOKEN}&team=core');
  assert.deepEqual(remote.def.headers, {
    Authorization: 'Bearer ${R_TOKEN}',
    Accept: 'json',
  });
  assert.deepEqual(placeholders(remote.def), ['R_TOKEN']);

  const clean = {
    name: 'fs',
    type: 'stdio' as const,
    command: 'npx',
    args: ['fs-mcp', '/tmp'],
  };
  assert.deepEqual(stripSecrets(clean), { def: clean, stripped: [] });
});

test('adding: JSON in three shapes, command lines with env and quotes, URLs', () => {
  const one = { name: 'fs', type: 'stdio', command: 'npx', args: ['fs'] };
  assert.deepEqual(
    parseServerJson('{"mcpServers":{"fs":{"command":"npx","args":["fs"]}}}'),
    [one],
  );
  assert.deepEqual(parseServerJson('{"fs":{"command":"npx","args":["fs"]}}'), [
    one,
  ]);
  assert.deepEqual(
    parseServerJson('{"name":"fs","command":"npx","args":["fs"]}'),
    [one],
  );
  assert.throws(
    () => parseServerJson('{"fs":{"args":[]}}'),
    /fs needs a command/,
  );
  assert.throws(() => parseServerJson('nope'), /isn't valid JSON/);
  assert.throws(
    () => parseServerJson('{"bad name":{"command":"x"}}'),
    /can't be a server name/,
  );

  assert.deepEqual(
    parseServerCommand(
      'gh',
      `GH_HOST=github.com npx -y "@scope/server" --dir 'a b'`,
    ),
    {
      name: 'gh',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@scope/server', '--dir', 'a b'],
      env: { GH_HOST: 'github.com' },
    },
  );
  assert.deepEqual(parseServerCommand('r', 'https://r.dev/mcp'), {
    name: 'r',
    type: 'http',
    url: 'https://r.dev/mcp',
  });
  assert.throws(() => parseServerCommand('x', '  '), /Type the command/);
});

test('skills: name and description from front matter, folder name otherwise', () => {
  assert.deepEqual(
    skillMeta(
      '---\nname: run\ndescription: "Launch the app"\n---\nBody',
      'folder',
    ),
    { name: 'run', description: 'Launch the app' },
  );
  assert.deepEqual(skillMeta('# No front matter', 'folder'), {
    name: 'folder',
    description: '',
  });
});

test('reads a custom command from its file: front matter first, else its first line', () => {
  assert.deepEqual(
    commandMeta(
      '---\ndescription: Draft notes\nargument-hint: "[since]"\n---\nWrite them.',
      'release-notes',
    ),
    {
      name: 'release-notes',
      description: 'Draft notes',
      argumentHint: '[since]',
    },
  );
  assert.deepEqual(
    commandMeta('\n# Fix the lint errors\n\nThen explain.', 'fix'),
    { name: 'fix', description: 'Fix the lint errors' },
  );
});

test('finds the install folders of user-scope plugins settings turn on', () => {
  const installed = JSON.stringify({
    version: 2,
    plugins: {
      'ponytail@ponytail': [
        { scope: 'user', installPath: '/p/ponytail/4.7.0' },
      ],
      'figma@official': [{ scope: 'user', installPath: '/p/figma' }],
      'local@market': [{ scope: 'project', installPath: '/p/local' }],
      'unlisted@market': [{ scope: 'user', installPath: '/p/unlisted' }],
    },
  });
  const settings = JSON.stringify({
    enabledPlugins: {
      'ponytail@ponytail': true,
      'figma@official': false,
      'local@market': true,
    },
  });
  assert.deepEqual(claudePluginRoots(installed, settings), [
    { name: 'ponytail', root: '/p/ponytail/4.7.0' },
  ]);
  assert.deepEqual(claudePluginRoots('', settings), []);
});
