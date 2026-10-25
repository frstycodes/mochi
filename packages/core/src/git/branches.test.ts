import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'vite-plus/test';
import {
  addBranchWorktree,
  assertFreeBranch,
  branchNameError,
  listBranches,
  renameAutoBranch,
  switchBranch,
} from './branches.ts';

// A Mochi session injects its commit-msg hook through GIT_CONFIG_*; the scratch repo's commits mustn't run it.
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_COUNT: '0',
};

function repo() {
  // `.native` also expands Windows 8.3 short names (RUNNER~1), which git never prints.
  const dir = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'mochi-branches-')),
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...process.env, ...IDENTITY },
      stdio: 'pipe',
    }).toString();
  git('init', '-q', '-b', 'main');
  // switchBranch's own git calls read run.ts's env snapshot, not IDENTITY: the work-in-progress commit needs a repo identity, and Windows runners set core.autocrlf.
  for (const [key, value] of [
    ['user.name', 't'],
    ['user.email', 't@t'],
    ['core.autocrlf', 'false'],
  ])
    git('config', key, value);
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
  for (const bad of [
    'has space',
    'a..b',
    'ends/',
    '-dash',
    'x.lock',
    'a~1',
    'what?',
  ])
    assert.match(
      (await branchNameError(dir, bad)) ?? '',
      /isn't a valid branch name/,
      bad,
    );
  assert.equal(
    await branchNameError(dir, 'feat/old'),
    'A branch named feat/old already exists',
  );
});

test('an existing branch checked out elsewhere is refused, saying where; a dirty checkout refuses a switch', async () => {
  const { dir, git } = repo();
  await assert.rejects(assertFreeBranch(dir, 'main'), {
    message: `main is already checked out in ${dir}`,
  });
  await assertFreeBranch(dir, 'feat/old');

  const other = join(
    realpathSync.native(mkdtempSync(join(tmpdir(), 'mochi-wt-'))),
    'wt',
  );
  git('worktree', 'add', '-q', other, 'feat/old');
  await assert.rejects(assertFreeBranch(dir, 'feat/old'), {
    message: `feat/old is already checked out in ${other}`,
  });
  await assert.rejects(
    switchBranch(dir, 'feat/old', { changes: 'stash' }),
    /already checked out/,
  );
  assert.equal(git('stash', 'list'), '', 'a refused branch stashes nothing');

  git('branch', 'feat/new');
  writeFileSync(join(dir, 'a.txt'), 'changed\n');
  await assert.rejects(
    switchBranch(dir, 'feat/new', { changes: 'refuse' }),
    /uncommitted changes/,
  );
  git('checkout', '--', 'a.txt');
  await switchBranch(dir, 'feat/new', { changes: 'refuse' });
  assert.equal(git('branch', '--show-current').trim(), 'feat/new');

  const list = await listBranches(dir);
  assert.equal(list.current, 'feat/new');
  assert.equal(list.defaultBranch, 'main');
  assert.deepEqual(list.changes, { files: 0, added: 0, removed: 0 });
  assert.equal(list.branches[0].name, 'feat/new', 'current branch first');
  assert.equal(
    list.branches.find((b) => b.name === 'feat/old')?.worktree,
    other,
  );
});

/** A repo on main with `a.txt` edited (one line removed, two added) and an untracked `new.txt` of three lines; `side` branches off first. */
function dirtyRepo() {
  const r = repo();
  r.git('branch', 'side');
  writeFileSync(join(r.dir, 'a.txt'), 'b\nc\n');
  writeFileSync(join(r.dir, 'new.txt'), '1\n2\n3');
  return r;
}

test('the change stat counts tracked lines from git diff HEAD plus untracked files and their lines', async () => {
  const { dir } = dirtyRepo();
  assert.deepEqual((await listBranches(dir)).changes, {
    files: 2,
    added: 5,
    removed: 1,
  });
});

test('stash: a named stash holds the changes and the target is clean', async () => {
  const { dir, git } = dirtyRepo();
  await switchBranch(dir, 'side', { changes: 'stash' });
  assert.equal(git('branch', '--show-current').trim(), 'side');
  assert.equal(git('status', '--porcelain'), '');
  assert.match(
    git('stash', 'list'),
    /^stash@\{0\}: On main: mochi: main before switching to side\n$/,
  );
  assert.match(
    git('stash', 'show', '--include-untracked', '--name-only'),
    /a\.txt\nnew\.txt/,
  );
});

test('stash: a switch that fails puts the changes back', async () => {
  const { dir, git } = dirtyRepo();
  // A branch deleted since the list was read: `git switch` fails only after the stash was made.
  await assert.rejects(
    switchBranch(dir, 'gone', { changes: 'stash' }),
    /invalid reference: gone/,
  );
  assert.equal(git('branch', '--show-current').trim(), 'main');
  assert.equal(git('stash', 'list'), '', 'the stash was popped back');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'b\nc\n');
  assert.ok(existsSync(join(dir, 'new.txt')));
});

test('commit: a work-in-progress commit on the current branch holds the changes and the target is clean', async () => {
  const { dir, git } = dirtyRepo();
  await switchBranch(dir, 'side', { changes: 'commit' });
  assert.equal(git('branch', '--show-current').trim(), 'side');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(
    git('log', '-1', '--format=%s', 'main').trim(),
    'chore: save work in progress before switching to side',
  );
  assert.equal(
    git('show', '--name-only', '--format=', 'main'),
    'a.txt\nnew.txt\n',
  );
  assert.equal(git('stash', 'list'), '');
});

test('commit: a switch that fails undoes the commit and leaves the changes uncommitted', async () => {
  const { dir, git } = dirtyRepo();
  const before = git('rev-parse', 'main');
  await assert.rejects(
    switchBranch(dir, 'gone', { changes: 'commit' }),
    /invalid reference: gone/,
  );
  assert.equal(git('rev-parse', 'main'), before);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'b\nc\n');
  assert.ok(existsSync(join(dir, 'new.txt')));
});

test('bring: the changes come along to the target', async () => {
  const { dir, git } = dirtyRepo();
  await switchBranch(dir, 'side', { changes: 'bring' });
  assert.equal(git('branch', '--show-current').trim(), 'side');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'b\nc\n');
  assert.ok(existsSync(join(dir, 'new.txt')));
  assert.equal(git('stash', 'list'), '');
});

test("bring: git's refusal on a conflict comes through and nothing moves", async () => {
  const { dir, git } = dirtyRepo();
  git('switch', '-q', '--discard-changes', 'side');
  writeFileSync(join(dir, 'a.txt'), 'side\n');
  git('commit', '-qam', 'side edits a');
  git('switch', '-q', 'main');
  writeFileSync(join(dir, 'a.txt'), 'mine\n');
  await assert.rejects(
    switchBranch(dir, 'side', { changes: 'bring' }),
    /would be overwritten/,
  );
  assert.equal(git('branch', '--show-current').trim(), 'main');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'mine\n');
});

test('discard: tracked changes reset, untracked files gone, target clean', async () => {
  const { dir, git } = dirtyRepo();
  await switchBranch(dir, 'side', { changes: 'discard' });
  assert.equal(git('branch', '--show-current').trim(), 'side');
  assert.equal(git('status', '--porcelain'), '');
  assert.ok(!existsSync(join(dir, 'new.txt')));
  assert.equal(git('stash', 'list'), '');
});

test('a temp branch is renamed after the title, made unique; a switched, published or tracking branch is left alone', async () => {
  const { dir, git } = repo();
  git('switch', '-c', 'mochi/0badf00d');
  git('branch', 'mochi/login-redirect');
  assert.equal(
    await renameAutoBranch(dir, 'mochi/0badf00d', 'Login redirect'),
    'mochi/login-redirect-2',
  );
  assert.equal(
    git('branch', '--show-current').trim(),
    'mochi/login-redirect-2',
  );
  assert.equal(
    await renameAutoBranch(dir, 'mochi/0badf00d', 'Other'),
    null,
    'HEAD changed',
  );
  assert.equal(
    await renameAutoBranch(dir, 'mochi/login-redirect-2', 'Other'),
    null,
    'not a temp name',
  );
  git('switch', '-c', 'mochi/feedf00d');
  assert.equal(
    await renameAutoBranch(dir, 'mochi/feedf00d', '???'),
    null,
    'no slug in the title',
  );
  git('update-ref', 'refs/remotes/origin/mochi/feedf00d', 'HEAD');
  assert.equal(
    await renameAutoBranch(dir, 'mochi/feedf00d', 'Other'),
    null,
    'published without an upstream',
  );
  git('update-ref', '-d', 'refs/remotes/origin/mochi/feedf00d');
  git('config', 'branch.mochi/feedf00d.remote', '.');
  git('config', 'branch.mochi/feedf00d.merge', 'refs/heads/main');
  assert.equal(
    await renameAutoBranch(dir, 'mochi/feedf00d', 'Other'),
    null,
    'tracking a branch',
  );
});

test("a thread's first start refuses a branch that exists; a restart or a branch you picked checks it out", async () => {
  const { dir, git } = repo();
  git('branch', 'mochi/0badf00d');
  const at = (name: string) => join(dir, '..', `${basename(dir)}-${name}`);
  const fresh = at('fresh');
  await assert.rejects(
    addBranchWorktree(dir, fresh, 'mochi/0badf00d', { isNew: true }),
    {
      message:
        "A branch named mochi/0badf00d already exists; name the thread's branch something else",
    },
  );
  assert.ok(!existsSync(fresh), 'no worktree made');

  const restart = at('restart');
  await addBranchWorktree(dir, restart, 'mochi/0badf00d');
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], { cwd: restart })
      .toString()
      .trim(),
    'mochi/0badf00d',
  );
  git('worktree', 'remove', restart);

  const picked = at('picked');
  await addBranchWorktree(dir, picked, 'mochi/0badf00d', {
    isNew: true,
    isExisting: true,
  });
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], { cwd: picked })
      .toString()
      .trim(),
    'mochi/0badf00d',
  );

  const created = at('created');
  await addBranchWorktree(dir, created, 'mochi/feedf00d', { isNew: true });
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], { cwd: created })
      .toString()
      .trim(),
    'mochi/feedf00d',
  );
});
