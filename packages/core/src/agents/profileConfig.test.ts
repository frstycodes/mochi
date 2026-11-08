import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vite-plus/test';
import { useAgentConfig } from './config.ts';
import {
  applyConfig,
  previewConfig,
  readProfileConfig,
} from './profileConfig.ts';

test('instructions-set rewrites the account’s CLAUDE.md, backs the old one up, and refuses a stale review', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mochi-instructions-'));
  // `homedir()` reads HOME on POSIX and USERPROFILE on Windows.
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  onTestFinished(() => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  useAgentConfig({
    read: () => undefined,
    write: async () => {},
    keychain: {
      isAvailable: async () => false,
      encrypt: async () => '',
      decrypt: async () => '',
    },
  });
  mkdirSync(join(home, '.claude'));
  const file = join(home, '.claude', 'CLAUDE.md');
  writeFileSync(file, 'old\n');
  const changes = [
    { kind: 'instructions-set', provider: 'claude', text: 'new\n' },
  ] as const;

  const { edits } = await previewConfig('p', [...changes]);
  assert.deepEqual(
    edits.map((e) => [e.path, e.before, e.after]),
    [[file, 'old\n', 'new\n']],
  );

  await assert.rejects(
    applyConfig('p', [...changes], { [file]: 'something else' }),
    /changed since/,
  );
  assert.equal(readFileSync(file, 'utf8'), 'old\n');

  const { backupDir } = await applyConfig('p', [...changes], {
    [file]: 'old\n',
  });
  assert.equal(readFileSync(file, 'utf8'), 'new\n');
  assert.ok(backupDir);
});

test('new composers discover shared, nested, system, project and enabled plugin skills before a session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mochi-composer-skills-'));
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  onTestFinished(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  useAgentConfig({
    read: () => undefined,
    write: async () => {},
    keychain: {
      isAvailable: async () => false,
      encrypt: async () => '',
      decrypt: async () => '',
    },
  });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const skill = (path: string, name: string) =>
    write(
      join(path, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Test skill\n---\nInstructions`,
    );
  skill(join(home, '.agents/skills/shared'), 'shared');
  skill(join(home, '.codex/skills/.system/creator'), 'creator');
  skill(join(home, '.codex/skills/nested/skill'), 'nested');
  skill(join(home, 'repo/.agents/skills/project'), 'project');
  skill(join(home, '.claude/skills/wrapper/skill'), 'claude-nested');
  symlinkSync(
    join(home, '.claude/skills'),
    join(home, '.claude/skills/loop'),
    'dir',
  );
  const cache = join(home, '.codex/plugins/cache/market');
  skill(join(cache, 'enabled/1.0.0/skills/old'), 'old');
  skill(join(cache, 'enabled/2.0.0/skills/current'), 'current');
  skill(join(cache, 'disabled/1.0.0/skills/disabled'), 'disabled');
  skill(
    join(cache, 'enabled/2.0.0/.codex-plugin/migrated-command-skills/alias'),
    'alias',
  );
  write(
    join(home, '.codex/config.toml'),
    `[plugins."enabled@market"]\nenabled = true\n[plugins."disabled@market"]\nenabled = false\n[[skills.config]]\npath = ${JSON.stringify(join(home, '.agents/skills/shared/SKILL.md'))}\nenabled = false\n`,
  );
  const config = await readProfileConfig('p', join(home, 'repo'));
  assert.equal(config.codex.error, undefined);
  assert.deepEqual(config.codex.skills.map((s) => s.name).sort(), [
    'creator',
    'nested',
    'shared',
  ]);
  assert.equal(
    config.codex.skills.find((s) => s.name === 'shared')?.enabled,
    false,
  );
  assert.deepEqual(config.codex.commands.map((c) => c.name).sort(), [
    'enabled:alias',
    'enabled:current',
    'project',
  ]);
  assert.deepEqual(config.codex.plugins, ['enabled@market']);
  assert.deepEqual(
    config.claude.skills.map((s) => s.name),
    ['claude-nested'],
  );
});
