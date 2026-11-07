import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, vi } from 'vite-plus/test';
import { useAgentConfig } from '../agents/config.ts';
import { moveWorktree } from './branches.ts';
import { createWorktree, git as hostGit } from './host.ts';

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
  assert.deepEqual(
    await createWorktree(repo, 'new-2', 'mochi/fix-login', {
      isExisting: true,
    }),
    { dir: moved, isNew: false },
  );
  const external = join(root, 'external');
  git('-C', repo, 'worktree', 'add', '-b', 'external', external);
  writeFileSync(join(external, 'a.txt'), 'uncommitted\n');
  assert.deepEqual(
    await createWorktree(repo, 'new-3', 'external', { isExisting: true }),
    { dir: external, isNew: false },
  );
  assert.deepEqual(
    await createWorktree(repo, 'new-4', 'main', { isExisting: true }),
    { dir: repo, isNew: false },
  );
  await assert.rejects(
    createWorktree(repo, 'new-5', 'external', { isNew: true }),
    /external/,
  );
});

vi.mock('./gh.ts', async (original) => ({
  ...(await original<typeof import('./gh.ts')>()),
  runGh: vi.fn(),
}));

test('summary excludes the published PR head but retains subsequent local work', async () => {
  const { runGh } = await import('./gh.ts');
  const cwd = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'mochi-pr-diff-')),
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env: { ...process.env, ...IDENTITY },
      encoding: 'utf8',
    }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(cwd, 'a.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  writeFileSync(join(cwd, 'a.txt'), 'published\n');
  git('commit', '-qam', 'PR');
  const published = git('rev-parse', 'HEAD');
  vi.mocked(runGh).mockResolvedValue(
    JSON.stringify({ headRefName: 'feature', headRefOid: published }),
  );
  const caller = {
    windowId: undefined,
    signal: new AbortController().signal,
    closed: new AbortController().signal,
  };
  const diff = () => hostGit.diff(caller, cwd, 'outside-pr', 'main');
  assert.deepEqual((await diff()).files, []);
  assert.equal(
    (await hostGit.diff(caller, cwd, 'branch', 'main')).files.length,
    1,
  );
  writeFileSync(join(cwd, 'local.txt'), 'unpushed\n');
  git('add', '.');
  git('commit', '-qm', 'local');
  assert.deepEqual(
    (await diff()).files.map((f) => f.path),
    ['local.txt'],
  );
  writeFileSync(join(cwd, 'a.txt'), 'staged\n');
  git('add', 'a.txt');
  writeFileSync(join(cwd, 'local.txt'), 'unstaged\n');
  writeFileSync(join(cwd, 'new.txt'), 'untracked\n');
  assert.deepEqual((await diff()).files.map((f) => f.path).sort(), [
    'a.txt',
    'local.txt',
    'new.txt',
  ]);
  vi.mocked(runGh).mockResolvedValue(
    JSON.stringify({ headRefName: 'other', headRefOid: published }),
  );
  assert.equal(
    (await diff()).files.find((f) => f.path === 'a.txt')?.removed,
    1,
  );
  vi.mocked(runGh).mockResolvedValue(
    JSON.stringify({ headRefName: 'feature', headRefOid: 'a'.repeat(40) }),
  );
  assert.deepEqual(
    (await diff()).files,
    (await hostGit.diff(caller, cwd, 'branch', 'main')).files,
  );
  vi.mocked(runGh).mockRejectedValue(new Error('unavailable'));
  assert.deepEqual(
    (await diff()).files,
    (await hostGit.diff(caller, cwd, 'branch', 'main')).files,
  );
});
