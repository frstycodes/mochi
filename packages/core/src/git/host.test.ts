import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { useAgentConfig } from '../agents/config.ts';
import { moveWorktree } from './branches.ts';
import { createWorktree } from './host.ts';

// A Mochi session injects its commit-msg hook through GIT_CONFIG_*; the scratch repo's commits mustn't run it.
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_COUNT: '0',
};

test('a restart finds the worktree its title moved, by its branch', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'mochi-host-')));
  const repo = join(root, 'proj');
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, ...IDENTITY },
      stdio: 'pipe',
    });
  git('init', '-q', '-b', 'main', repo);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('-C', repo, 'add', '.');
  git('-C', repo, 'commit', '-qm', 'init');
  useAgentConfig({
    read: () => ({ worktreeRoot: join(root, 'trees') }),
    write: async () => {},
    keychain: {
      isAvailable: async () => false,
      encrypt: async () => '',
      decrypt: async () => '',
    },
  });

  const made = await createWorktree(repo, 'new-1', 'mochi/0badf00d', {
    isNew: true,
  });
  assert.deepEqual(made, {
    dir: join(root, 'trees', 'proj', 'new-1'),
    isNew: true,
  });
  git('-C', made.dir, 'branch', '-m', 'mochi/fix-login');
  const moved = await moveWorktree(made.dir, 'fix-login');

  assert.deepEqual(await createWorktree(repo, 'new-1', 'mochi/fix-login'), {
    dir: moved,
    isNew: false,
  });
  await assert.rejects(
    createWorktree(repo, 'new-2', 'mochi/fix-login', { isExisting: true }),
    /mochi\/fix-login/,
    "a branch you picked that another thread's worktree has is refused, not shared",
  );
});
