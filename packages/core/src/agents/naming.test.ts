import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { AgentEvent } from '../../../../src/host/types/agent.ts';
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

function repo() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mochi-naming-')));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...process.env, ...IDENTITY },
      stdio: 'pipe',
    })
      .toString()
      .trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('switch', '-qc', 'mochi/0badf00d');
  return { dir, git };
}

const naming = (
  title: Promise<string | null>,
  change?: (starts: Starts) => void,
) => {
  const { dir, git } = repo();
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
    git,
  };
};

test('the title renames the temp branch, then names the thread, before the agent starts', async () => {
  const { done, events, git } = naming(Promise.resolve('Fix login redirect'));
  await done;
  assert.equal(git('branch', '--show-current'), 'mochi/fix-login-redirect');
  assert.deepEqual(events, [
    { threadId: 'new-1', type: 'branch', branch: 'mochi/fix-login-redirect' },
    { threadId: 'new-1', type: 'title', title: 'Fix login redirect' },
  ]);
});

test('no title in time, no title at all, or your own name meanwhile leaves the temp branch for the fallback', async () => {
  const late = naming(new Promise(() => {}));
  const none = naming(Promise.resolve(null));
  const renamed = naming(Promise.resolve('Fix login'), (starts) =>
    starts.keepTitle('new-1'),
  );
  for (const { done, events, git } of [late, none, renamed]) {
    await done;
    assert.equal(git('branch', '--show-current'), 'mochi/0badf00d');
    assert.deepEqual(events, []);
  }
});
