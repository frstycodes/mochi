import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent } from '../runtime/apply.ts';
import { agentCalls } from '../runtime/live.ts';
import { planMove, type MoveChecks } from '../runtime/moves.ts';
import type { BranchList } from '../host/types/git.ts';
import { setWorktreePath } from './worktrees.ts';
import { threadCwd } from '../host/cwd.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);
const calls = (s: State, action: Action) => agentCalls(s, action, () => run(s, action));
const idea = { project: 'idea', path: '/Users/me/dev/idea', branch: 'main', mode: 'folder' as const };

function chat() {
  let s = run(base(), { type: 'create', title: 'sketch an idea', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 'sess-1' });
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
  return { s, id };
}

test('a folderless chat moved into a project resumes the same session there, told that its folder changed', () => {
  let { s, id } = chat();
  s = run(s, { type: 'move-request', threadId: id, move: { root: idea.path, changes: 'stash' } });
  assert.deepEqual(s.threads.find((t) => t.id === id)!.move, { root: idea.path, changes: 'stash' });
  const move: Action = { type: 'move', threadId: id, to: { repo: idea, result: { cwd: idea.path, head: { branch: 'main', isDetached: false } }, from: '/Users/me/.harness/chats/x' } };
  const [start] = calls(s, move);
  s = run(s, move);
  const moved = s.threads.find((t) => t.id === id)!;
  assert.equal(threadCwd(moved, true), idea.path);
  assert.equal(moved.move, undefined);
  assert.equal(moved.session?.id, 'sess-1', 'the session is kept');
  assert.equal(moved.activity[0].text, 'sketch an idea', 'the history is kept');
  assert.match(moved.activity.at(-1)!.text, /^Moved to idea on main/);
  assert.equal(moved.live?.isWorking, true);
  assert.equal(moved.turn?.isAgentDriven, true);

  assert.equal(start.method, 'start');
  if (start.method !== 'start') return;
  assert.equal(start.options.resume, 'sess-1');
  assert.equal(start.options.cwd, idea.path);
  assert.equal(start.options.workspace, undefined, 'main set the folder up already');
  assert.match(start.options.prompt, /^\[Mochi: the move you asked for is done; this thread is now in idea on main.*working directory is \/Users\/me\/dev\/idea, no longer \/Users\/me\/\.harness\/chats\/x.*\]\n\nContinue where you left off\.$/s);
});

test('a failed move resumes the agent where it was, told why', () => {
  let { s, id } = chat();
  s = run(s, { type: 'move-request', threadId: id, move: { root: idea.path, changes: 'stash' } });
  const failed: Action = { type: 'move-failed', threadId: id, error: 'nope' };
  const [start] = calls(s, failed);
  s = run(s, failed);
  assert.equal(s.threads.find((t) => t.id === id)!.move, undefined);
  assert.equal(start.method === 'start' && start.options.resume, 'sess-1');
  assert.match(start.method === 'start' ? start.options.prompt : '', /^\[Mochi: the move you asked for failed, so nothing moved: nope\]/);
});

test('a worktree move keeps PRs and the parent link; Auto-fix stays on only on the same project and branch', () => {
  let s = run(base(), { type: 'create', title: 'fix login', provider: 'codex', project: '/Users/me/dev/app', isLive: true, parent: { threadId: 'p1' } });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'prs-seen', threadId: id, prs: [{ number: 7, state: 'open', title: 'Fix login', url: 'https://github.com/me/app/pull/7', autofixSince: 1 }] });
  const { repo, prs } = s.threads.find((t) => t.id === id)!;
  assert.ok(prs[0].autofixSince);
  const to = (onBranch: string) => ({ repo: { project: 'app', path: '/Users/me/dev/app', branch: onBranch }, result: { cwd: `/wt/${id}`, head: { branch: onBranch, isDetached: false } }, from: '/Users/me/dev/app' });

  const sameBranch = run(s, { type: 'move', threadId: id, to: to(repo!.branch) }).threads.find((t) => t.id === id)!;
  assert.equal(sameBranch.prs[0].autofixSince, prs[0].autofixSince);
  assert.deepEqual(sameBranch.parent, { threadId: 'p1' });

  const otherBranch = run(s, { type: 'move', threadId: id, to: to('feat/other') }).threads.find((t) => t.id === id)!;
  assert.equal(otherBranch.prs[0].autofixSince, undefined);
  assert.equal(otherBranch.prs[0].url, 'https://github.com/me/app/pull/7', 'the PR stays the thread’s');

  setWorktreePath(id, `/wt/${id}`);
  assert.equal(threadCwd(otherBranch, true), `/wt/${id}`);
  setWorktreePath(id, null);
});

test('move_thread is checked when called: a missing folder, a taken branch and a non-repo branch fail before the turn ends', async () => {
  const { s, id } = chat();
  const thread = s.threads.find((t) => t.id === id)!;
  const folders = new Set(['/Users/me/dev/idea', '/Users/me/dev/plain', '/Users/me/.harness/chats/x']);
  const list = { current: 'main', defaultBranch: 'main', branches: [] } as unknown as BranchList;
  const checks: MoveChecks = {
    isFolder: async (path) => folders.has(path),
    branches: async (root) => (root === '/Users/me/dev/idea' ? list : Promise.reject(new Error('not a repo'))),
    branchNameError: async (_root, name) => (name === 'main' ? 'A branch named main already exists' : null),
    prefs: { workspaceMode: 'worktree', branchPrefix: 'mochi/' },
  };
  await assert.rejects(planMove(thread, { project: '/Users/me/dev/gone' }, checks), /isn't a folder/);
  await assert.rejects(planMove(thread, { project: 'relative' }, checks), /absolute path/);
  await assert.rejects(planMove(thread, { project: idea.path, branch: 'main' }, checks), /already exists/);
  await assert.rejects(planMove(thread, { project: '/Users/me/dev/plain', workspace: 'worktree' }, checks), /isn't a git repository/);
  await assert.rejects(planMove(thread, { project: idea.path, fromFolder: '/Users/me/.harness/chats/x' }, checks), /already exists/);

  assert.deepEqual(await planMove(thread, { project: idea.path, workspace: 'folder' }, checks), { root: idea.path, workspace: { mode: 'folder', branch: 'main' }, changes: 'stash' });
  assert.deepEqual(await planMove(thread, { project: '/Users/me/dev/new', fromFolder: '/Users/me/.harness/chats/x', gitInit: true }, checks), { root: '/Users/me/dev/new', changes: 'stash', files: { from: '/Users/me/.harness/chats/x', transfer: 'move' }, gitInit: true });
  const worktree = await planMove(thread, { project: idea.path }, checks);
  assert.match(worktree.workspace?.branch ?? '', /^mochi\/[0-9a-f]{8}$/);
});
