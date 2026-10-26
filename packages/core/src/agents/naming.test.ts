import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import { nameThread } from './naming.ts';
import { Starts } from './starts.ts';

// A Mochi session injects its commit-msg hook through GIT_CONFIG_*; the scratch repo's commits mustn't run it.
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_COUNT: '0',
};

// A thread's worktree `new-1` of a scratch repo, on its temp branch.
function repo() {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'mochi-naming-')),
  );
  const main = join(root, 'main');
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env: { ...process.env, ...IDENTITY },
      stdio: 'pipe',
    })
      .toString()
      .trim();
  run(root, 'init', '-q', '-b', 'main', main);
  writeFileSync(join(main, 'a.txt'), 'a\n');
  run(main, 'add', '.');
  run(main, 'commit', '-qm', 'init');
  const dir = join(root, 'new-1');
  run(main, 'worktree', 'add', '-q', '-b', 'mochi/0badf00d', dir);
  return { root, dir, git: (...args: string[]) => run(main, ...args) };
}

const naming = (
  title: Promise<string | null>,
  change?: (starts: Starts) => void,
) => {
  const { root, dir, git } = repo();
  const starts = new Starts();
  const start = starts.begin('new-1');
  change?.(starts);
  const events: AgentEvent[] = [];
  return {
    done: nameThread(
      'new-1',
      dir,
      'mochi/0badf00d',
      title,
      start,
      (e) => events.push(e),
      50,
    ),
    events,
    root,
    dir,
    git,
  };
};

const branchIn = (dir: string) =>
  execFileSync('git', ['branch', '--show-current'], { cwd: dir })
    .toString()
    .trim();

test('the title renames the temp branch and moves the worktree after it, then names the thread, before the agent starts', async () => {
  const { done, events, root, dir } = naming(
    Promise.resolve('Fix login redirect'),
  );
  const moved = join(root, 'fix-login-redirect');
  assert.equal(await done, moved);
  assert.ok(!existsSync(dir));
  assert.equal(branchIn(moved), 'mochi/fix-login-redirect');
  assert.deepEqual(events, [
    { threadId: 'new-1', type: 'branch', branch: 'mochi/fix-login-redirect' },
    { threadId: 'new-1', type: 'worktree', path: moved },
    { threadId: 'new-1', type: 'title', title: 'Fix login redirect' },
  ]);
});

test("a folder that's taken, or would look like a thread's own, gets a suffix", async () => {
  const taken = naming(Promise.resolve('Fix login'));
  mkdirSync(join(taken.root, 'fix-login'));
  assert.equal(await taken.done, join(taken.root, 'fix-login-2'));
  const threadLike = naming(Promise.resolve('New 7'));
  assert.equal(await threadLike.done, join(threadLike.root, 'new-7-2'));
});

test('no title in time, no title at all, or your own name meanwhile leaves the temp branch for the fallback', async () => {
  const late = naming(new Promise(() => {}));
  const none = naming(Promise.resolve(null));
  const renamed = naming(Promise.resolve('Fix login'), (starts) =>
    starts.keepTitle('new-1'),
  );
  for (const { done, events, dir } of [late, none, renamed]) {
    assert.equal(await done, dir);
    assert.equal(branchIn(dir), 'mochi/0badf00d');
    assert.deepEqual(events, []);
  }
});

test("a branch it can't rename keeps its temp name, and the thread still gets its title", async () => {
  const { done, events, dir, git } = naming(
    Promise.resolve('Fix login redirect'),
  );
  git('update-ref', 'refs/remotes/origin/mochi/0badf00d', 'HEAD');
  assert.equal(await done, dir);
  assert.equal(branchIn(dir), 'mochi/0badf00d');
  assert.deepEqual(events, [
    { threadId: 'new-1', type: 'title', title: 'Fix login redirect' },
  ]);
});
