import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { setWorktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';
import { repoFor } from '../projects.ts';
import { remoteThreadId } from '../remote/ids.ts';
import { threadCwd } from './cwd.ts';

const thread = (id: string, repo: Thread['repo']) => ({ id, repo }) as Thread;

test('threadCwd: the worktree, else the absolute project folder; never a relative placeholder on desktop', () => {
  const project = thread('t1', repoFor('/Users/me/dev/app', 'feat/t1'));
  assert.equal(threadCwd(project, true), '/Users/me/dev/app');
  setWorktreePath('t1', '/Users/me/.harness/worktrees/app/t1');
  assert.equal(threadCwd(project, true), '/Users/me/.harness/worktrees/app/t1');
  setWorktreePath('t1', null);

  assert.equal(
    threadCwd({ ...project, repo: { ...project.repo!, mode: 'folder' } }, true),
    '/Users/me/dev/app',
    'a project folder thread',
  );
  setWorktreePath('t1', '/Users/me/.harness/worktrees/app/t1');
  assert.equal(
    threadCwd(
      {
        ...project,
        repo: { ...project.repo!, mode: 'folder' },
        live: { cwd: '/Users/me/dev/app' },
      } as Thread,
      true,
    ),
    '/Users/me/.harness/worktrees/app/t1',
    'a worktree wins over the mode and the folder the agent started in',
  );
  setWorktreePath('t1', null);

  assert.equal(threadCwd(thread('t2', null), true), null, 'a folderless chat');
  assert.equal(
    threadCwd(
      {
        ...thread('t2', null),
        live: { cwd: '/Users/me/.harness/chats/t2' },
      } as Thread,
      true,
    ),
    '/Users/me/.harness/chats/t2',
    'a started folderless chat: the folder main made',
  );
  assert.equal(
    threadCwd(thread('t3', repoFor('latitude', 'feat/x')), true),
    null,
    'a fixture project has no folder on desktop',
  );
  assert.equal(
    threadCwd(thread('t3', repoFor('latitude', 'feat/x')), false),
    '.',
    "the web build's mocks take any root",
  );
});

test('repoFor keeps an absolute path and names the project after its folder', () => {
  assert.deepEqual(repoFor('/Users/me/dev/app/', 'b'), {
    project: 'app',
    branch: 'b',
    path: '/Users/me/dev/app/',
  });
  assert.deepEqual(repoFor('C:\\code\\app', 'b'), {
    project: 'app',
    branch: 'b',
    path: 'C:\\code\\app',
  });
  assert.deepEqual(repoFor('~/dev/app', 'b'), { project: 'app', branch: 'b' });
});

test('threadCwd: another computer’s thread has no folder here, even when this computer has the same path or worktree id', () => {
  const id = remoteThreadId('m1', 't1');
  setWorktreePath(id, '/Users/me/.harness/worktrees/app/t1');
  const remote = {
    ...thread(id, repoFor('/Users/me/dev/app', 'feat/t1')),
    live: { cwd: '/Users/me/dev/app' },
  } as Thread;
  const errors = mockConsoleError();
  assert.equal(threadCwd(remote, true), null);
  assert.equal(threadCwd({ ...remote, repo: null }, true), null, 'a chat');
  assert.equal(threadCwd(remote, false), null, 'the web build');
  setWorktreePath(id, null);
  assert.equal(errors.restore(), 1, 'reported once per thread in dev');
});

function mockConsoleError() {
  const original = console.error;
  let count = 0;
  console.error = () => void count++;
  return {
    restore: () => {
      console.error = original;
      return count;
    },
  };
}
