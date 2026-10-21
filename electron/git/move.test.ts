import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { moveCheckout } from './move.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_COUNT: '0' };

function scratch(prefix: string) {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

function repo() {
  const dir = scratch('mochi-move-');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...IDENTITY }, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main');
  for (const [key, value] of [['user.name', 't'], ['user.email', 't@t'], ['core.autocrlf', 'false']]) git('config', key, value);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  const worktrees = scratch('mochi-move-wt-');
  return { dir, git, worktreeDir: () => join(worktrees, 'thread') };
}

const dirty = (dir: string) => {
  writeFileSync(join(dir, 'a.txt'), 'changed\n');
  writeFileSync(join(dir, 'new.txt'), 'new\n');
};

test('main checkout → new worktree brings the uncommitted changes and leaves the checkout clean', async () => {
  const { dir, git, worktreeDir } = repo();
  dirty(dir);
  const moved = await moveCheckout('t1', dir, dir, { mode: 'worktree', branch: 'feat/x', base: 'main' }, 'bring', worktreeDir);
  assert.equal(moved.cwd, worktreeDir());
  assert.equal(moved.isNew, true);
  assert.equal(readFileSync(join(moved.cwd, 'a.txt'), 'utf8'), 'changed\n');
  assert.equal(readFileSync(join(moved.cwd, 'new.txt'), 'utf8'), 'new\n');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('stash', 'list'), '');
});

test('stash leaves the changes in a named stash of the old checkout', async () => {
  const { dir, git, worktreeDir } = repo();
  dirty(dir);
  const moved = await moveCheckout('t1', dir, dir, { mode: 'worktree', branch: 'feat/x' }, 'stash', worktreeDir);
  assert.match(moved.stash ?? '', /^mochi: t1 before moving/);
  assert.equal(readFileSync(join(moved.cwd, 'a.txt'), 'utf8'), 'a\n');
  assert.equal(git('status', '--porcelain'), '');
  assert.match(git('stash', 'list'), /mochi: t1 before moving/);
});

test("the thread's own checkout switches branch in place, carrying its changes", async () => {
  const { dir, git, worktreeDir } = repo();
  git('branch', 'feat/old');
  dirty(dir);
  const moved = await moveCheckout('t1', dir, dir, { mode: 'folder', branch: 'feat/old', isExisting: true }, 'bring', worktreeDir);
  assert.equal(moved.cwd, dir);
  assert.equal(git('branch', '--show-current').trim(), 'feat/old');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'changed\n');
});

test('changes never cross repositories: bring is refused and nothing is touched', async () => {
  const a = repo();
  const b = repo();
  dirty(a.dir);
  await assert.rejects(moveCheckout('t1', a.dir, b.dir, { mode: 'folder', branch: 'main' }, 'bring', b.worktreeDir), /only come along within the same repository/);
  assert.equal(readFileSync(join(a.dir, 'a.txt'), 'utf8'), 'changed\n');
  assert.equal(a.git('stash', 'list'), '');
});

test("changes that don't apply on the new branch go back where they were", async () => {
  const { dir, git, worktreeDir } = repo();
  git('switch', '-qc', 'other');
  writeFileSync(join(dir, 'a.txt'), 'other\n');
  git('commit', '-qam', 'other');
  git('switch', '-q', 'main');
  dirty(dir);
  await assert.rejects(moveCheckout('t1', dir, dir, { mode: 'worktree', branch: 'feat/x', base: 'other' }, 'bring', worktreeDir), /don't apply on the new branch/);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'changed\n');
  assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'new\n');
  assert.equal(git('stash', 'list'), '');
});

test('a folder that is not a repository is used as it is', async () => {
  const folder = scratch('mochi-move-plain-');
  const moved = await moveCheckout('t1', null, folder, undefined, 'bring', () => join(folder, 'never'));
  assert.deepEqual(moved, { cwd: folder, isNew: false });
  assert.equal(existsSync(join(folder, 'never')), false);
});
