import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setWorktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';
import { repoFor } from '../projects.ts';
import { threadCwd } from './cwd.ts';

const thread = (id: string, repo: Thread['repo']) => ({ id, repo }) as Thread;

test('threadCwd: the worktree, else the absolute project folder; never a relative placeholder on desktop', () => {
  const project = thread('t1', repoFor('/Users/me/dev/app', 'feat/t1'));
  assert.equal(threadCwd(project, true), '/Users/me/dev/app');
  setWorktreePath('t1', '/Users/me/.harness/worktrees/app/t1');
  assert.equal(threadCwd(project, true), '/Users/me/.harness/worktrees/app/t1');
  setWorktreePath('t1', null);

  assert.equal(threadCwd(thread('t2', null), true), null, 'a folderless chat');
  assert.equal(threadCwd(thread('t3', repoFor('latitude', 'feat/x')), true), null, 'a fixture project has no folder on desktop');
  assert.equal(threadCwd(thread('t3', repoFor('latitude', 'feat/x')), false), '.', "the web build's mocks take any root");
});

test('repoFor keeps an absolute path and names the project after its folder', () => {
  assert.deepEqual(repoFor('/Users/me/dev/app/', 'b'), { project: 'app', branch: 'b', path: '/Users/me/dev/app/' });
  assert.deepEqual(repoFor('C:\\code\\app', 'b'), { project: 'app', branch: 'b', path: 'C:\\code\\app' });
  assert.deepEqual(repoFor('~/dev/app', 'b'), { project: 'app', branch: 'b' });
});
