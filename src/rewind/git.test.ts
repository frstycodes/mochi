import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyFiles, changedPaths, checkpointRef, resolveCommit, restore, snapshot, snapshotCommit } from '../../electron/git/checkpoints.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-rewind-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('snapshot saves tracked and untracked files without touching HEAD, index or files; restore puts them back', async () => {
  const dir = scratchRepo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    writeFileSync(join(dir, 'new.txt'), 'untracked\n');
    git(dir, 'add', 'a.txt');
    const head = git(dir, 'rev-parse', 'HEAD');
    const status = git(dir, 'status', '--porcelain');
    const commit = await snapshot(dir, checkpointRef('t1', 0), 'cp');
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
    assert.equal(git(dir, 'status', '--porcelain'), status);
    assert.equal(await resolveCommit(dir, 'refs/harness/checkpoints/t1/0'), commit);

    // The agent moves on: commits, edits, adds and deletes files.
    git(dir, 'commit', '-qam', 'later');
    writeFileSync(join(dir, 'a.txt'), 'three\n');
    writeFileSync(join(dir, 'later.txt'), 'later\n');
    rmSync(join(dir, 'new.txt'));
    writeFileSync(join(dir, 'ignored.txt'), 'keep me\n');

    await restore(dir, commit);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'branch back at the checkpoint’s parent');
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'two\n');
    assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'untracked\n');
    assert.ok(!existsSync(join(dir, 'later.txt')), 'files from after the checkpoint are gone');
    assert.ok(existsSync(join(dir, 'ignored.txt')), 'ignored files are left alone');
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '', 'changes come back unstaged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fork worktree starts from the checkpoint’s files', async () => {
  const dir = scratchRepo();
  const fork = `${dir}-fork`;
  try {
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const commit = await snapshot(dir, checkpointRef('t1', 3), 'cp');
    git(dir, 'worktree', 'add', '-q', '-b', 'fork', fork, `${commit}^`);
    await applyFiles(fork, commit);
    assert.equal(readFileSync(join(fork, 'a.txt'), 'utf8'), 'two\n');
    assert.equal(git(dir, 'branch', '--show-current'), 'main', 'the source branch is untouched');
  } finally {
    rmSync(fork, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkpointRef rejects names that could escape the refs/harness namespace', () => {
  assert.throws(() => checkpointRef('../heads/main', 1));
  assert.throws(() => checkpointRef('t1', -1));
  assert.equal(checkpointRef('t1', 'undo'), 'refs/harness/checkpoints/t1/undo');
});

test('a rewind preview lists the files a checkpoint changes back, and tells the agent’s changes from later ones', async () => {
  const dir = scratchRepo();
  try {
    assert.equal(await resolveCommit(dir, checkpointRef('t1', 'turn')), '', 'a missing checkpoint resolves empty instead of throwing');
    const before = await snapshot(dir, checkpointRef('t1', 0), 'before message');
    writeFileSync(join(dir, 'a.txt'), 'agent edit\n');
    writeFileSync(join(dir, 'b.txt'), 'agent new file\n');
    await snapshot(dir, checkpointRef('t1', 'turn'), 'turn end');
    assert.deepEqual(await changedPaths(dir, before, await snapshotCommit(dir, 'now')), ['a.txt', 'b.txt']);
    assert.deepEqual(await changedPaths(dir, await resolveCommit(dir, checkpointRef('t1', 'turn')), await snapshotCommit(dir, 'now')), [], 'nothing changed since the turn');
    writeFileSync(join(dir, 'c.txt'), 'yours\n');
    assert.deepEqual(await changedPaths(dir, await resolveCommit(dir, checkpointRef('t1', 'turn')), await snapshotCommit(dir, 'now')), ['c.txt'], 'your file reads as an outside change');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
