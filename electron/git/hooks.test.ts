import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hooksEnv, installHooks } from './hooks.ts';

test('agents commit with Conventional Commits only, and the repo hooks still run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-hooks-'));
  const hooks = join(root, 'mochi-hooks');
  const repo = join(root, 'repo');
  await installHooks(hooks);
  execFileSync('git', ['init', '-q', repo]);
  const own = join(repo, '.git', 'hooks', 'commit-msg');
  writeFileSync(own, `#!/bin/sh\necho ran >> "${join(root, 'own.log')}"\n`);
  chmodSync(own, 0o755);
  const env = { ...hooksEnv(process.env, hooks), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const commit = (message: string) => spawnSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', message], { env, encoding: 'utf8' });

  const bad = commit('Update stuff');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Conventional Commits/);
  assert.equal(commit(`feat: ${'x'.repeat(80)}`).status, 1, 'subject too long');
  assert.equal(commit('fix(auth): keep the session cookie').status, 0);
  assert.equal(readFileSync(join(root, 'own.log'), 'utf8'), 'ran\n', "the repo's own commit-msg ran once, for the accepted commit");
});
