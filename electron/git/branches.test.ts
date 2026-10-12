import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertFreeBranch, branchNameError, listBranches, switchBranch } from './branches.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mochi-branches-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...IDENTITY }, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  git('branch', 'feat/old');
  return { dir, git };
}

test('branch names: check-ref-format rejects bad names, existing branches are taken', async () => {
  const { dir } = repo();
  assert.equal(await branchNameError(dir, 'mochi/fix-login'), null);
  assert.equal(await branchNameError(dir, ''), 'Name the branch');
  for (const bad of ['has space', 'a..b', 'ends/', '-dash', 'x.lock', 'a~1', 'what?']) assert.match((await branchNameError(dir, bad)) ?? '', /isn't a valid branch name/, bad);
  assert.equal(await branchNameError(dir, 'feat/old'), 'A branch named feat/old already exists');
});

test("an existing branch checked out elsewhere is refused, saying where; a dirty checkout refuses a switch", async () => {
  const { dir, git } = repo();
  await assert.rejects(assertFreeBranch(dir, 'main'), { message: `main is already checked out in ${dir}` });
  await assertFreeBranch(dir, 'feat/old');

  const other = join(realpathSync(mkdtempSync(join(tmpdir(), 'mochi-wt-'))), 'wt');
  git('worktree', 'add', '-q', other, 'feat/old');
  await assert.rejects(assertFreeBranch(dir, 'feat/old'), { message: `feat/old is already checked out in ${other}` });
  await assert.rejects(switchBranch(dir, 'feat/old'), /already checked out/);

  git('branch', 'feat/new');
  writeFileSync(join(dir, 'a.txt'), 'changed\n');
  await assert.rejects(switchBranch(dir, 'feat/new'), /uncommitted changes/);
  git('checkout', '--', 'a.txt');
  await switchBranch(dir, 'feat/new');
  assert.equal(git('branch', '--show-current').trim(), 'feat/new');

  const list = await listBranches(dir);
  assert.equal(list.current, 'feat/new');
  assert.equal(list.defaultBranch, 'main');
  assert.equal(list.isDirty, false);
  assert.equal(list.branches[0].name, 'feat/new', 'current branch first');
  assert.equal(list.branches.find((b) => b.name === 'feat/old')?.worktree, other);
});
