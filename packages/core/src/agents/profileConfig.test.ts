import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vite-plus/test';
import { useAgentConfig } from './config.ts';
import { applyConfig, previewConfig } from './profileConfig.ts';

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
