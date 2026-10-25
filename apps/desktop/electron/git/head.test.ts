import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { recoverCheckouts } from '../../src/git/recovery.ts';
import type { Thread } from '../../src/model.ts';
import { headOf } from './branches.ts';
import { listWorktrees } from './run.ts';

const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_COUNT: '0',
};

function repo() {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'mochi-head-')));
  const dir = join(base, 'app');
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...process.env, ...IDENTITY },
      stdio: 'pipe',
    })
      .toString()
      .trim();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  return { base, dir, git };
}

const thread = (
  id: string,
  repo: Thread['repo'],
  extra: Partial<Thread> = {},
) =>
  ({ id, repo, session: { id: 's' }, status: 'running', ...extra }) as Thread;

test('headOf: a branch by name, a detached HEAD as its short commit', async () => {
  const { dir, git } = repo();
  assert.deepEqual(await headOf(dir), { branch: 'main', isDetached: false });
  git('checkout', '-q', '--detach');
  assert.deepEqual(await headOf(dir), {
    branch: git('rev-parse', '--short', 'HEAD'),
    isDetached: true,
  });
});

test("recovery: a thread's worktree on disk becomes its folder and branch; a folder thread shows its checkout, detached said as such", async () => {
  const { base, dir, git } = repo();
  const wt = join(base, 'worktrees', 'app', 'new-36');
  git('worktree', 'add', '-q', '-b', 'feat/theme', wt);
  git('checkout', '-q', '--detach');
  const sha = git('rev-parse', '--short', 'HEAD');
  const host = {
    worktrees: async (root: string) =>
      (await listWorktrees(root)).filter((w) => w.path !== root),
    head: headOf,
  };
  const stale = {
    project: 'app',
    path: dir,
    branch: sha,
    mode: 'folder' as const,
  };
  const found = await recoverCheckouts(
    [
      thread('new-36', stale),
      thread('new-37', { ...stale, branch: 'feat/never-made' }),
      thread('new-38', { ...stale, branch: 'feat/old' }, { status: 'settled' }),
      thread('new-39', {
        project: 'app',
        path: dir,
        branch: 'feat/cleaned-up',
      }),
      thread('new-40', stale, { session: undefined }),
    ],
    () => undefined,
    host,
  );
  assert.deepEqual(found, [
    {
      threadId: 'new-36',
      head: { branch: 'feat/theme', isDetached: false },
      worktree: wt,
    },
    { threadId: 'new-37', head: { branch: sha, isDetached: true } },
  ]);
  // Recorded: nothing more to recover on the next launch.
  const recovered = thread(
    'new-36',
    { project: 'app', path: dir, branch: 'feat/theme' },
    { live: { cwd: wt, isWorking: false } },
  );
  assert.deepEqual(await recoverCheckouts([recovered], () => wt, host), []);
});
