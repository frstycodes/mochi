import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent } from './apply.ts';
import { agentOptions, initialControls } from './controls.ts';
import { agentCalls, CONTINUE_PROMPT, resumeAfterLostProcess, scheduledStart } from './live.ts';
import { isUnstarted, type WorkspaceDraft } from '../git/workspace.ts';
import { setWorktreePath } from '../git/worktrees.ts';
import { threadCwd } from '../host/cwd.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const calls = (s: State, action: Action) => agentCalls(s, action, () => threadsReducer(s, action));
const run = (s: State, action: Action) => threadsReducer(s, action);

test('a live new thread starts its agent, follow-ups send, stop interrupts; demo threads never reach host.agent', () => {
  const create: Action = { type: 'create', title: 'reply with ok', provider: 'claude', project: '/Users/me/dev/harness', isLive: true, controls: { model: 'sonnet-5.5', effort: 'Low', access: 'Manual' } };
  let s = base();
  const [start] = calls(s, create);
  assert.equal(start.method, 'start');
  assert.deepEqual(start.method === 'start' && start.options, { provider: 'claude', spaceId: 'latitude', cwd: '/Users/me/dev/harness', workspace: { mode: 'worktree', branch: start.threadId }, prompt: 'reply with ok', model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'default' });

  s = run(s, create);
  const id = start.threadId;
  const thread = s.threads.find((t) => t.id === id)!;
  assert.deepEqual(thread.steps, [], 'no demo placeholder steps on a live thread');
  assert.equal(thread.live?.isWorking, true);
  assert.equal(run(s, { type: 'tick' }).threads.find((t) => t.id === id)!.activity.length, thread.activity.length, 'the demo tick leaves live threads alone');

  assert.deepEqual(calls(s, { type: 'send', threadId: id, text: 'and add a test', drift: 'on-goal', reason: '' }), [{ method: 'send', threadId: id, text: 'and add a test' }]);
  assert.deepEqual(calls(s, { type: 'interrupt', threadId: id }), [{ method: 'interrupt', threadId: id }]);

  assert.deepEqual(calls(base(), { type: 'create', title: 'demo', provider: 'claude', project: 'harness' }), []);
  assert.deepEqual(calls(base(), { type: 'send', threadId: 'adm', text: 'hi', drift: 'on-goal', reason: '' }), []);
});

test('a limit pauses the thread; resume sends on the same account, the API key choice restarts the session on the key, handoff restarts on the other provider', () => {
  const create: Action = { type: 'create', title: 'reply with ok', provider: 'claude', project: 'harness', isLive: true };
  let s = run(base(), create);
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 'sess-1' });
  s = applyAgentEvent(s, { threadId: id, type: 'limit', resetsAt: '2026-10-12T18:00:00Z' });
  const paused = s.threads.find((t) => t.id === id)!;
  assert.deepEqual(paused.live?.limit, { resetsAt: '2026-10-12T18:00:00Z' });
  assert.equal(paused.status, 'needs-you');

  assert.deepEqual(calls(s, { type: 'resume', threadId: id }), [{ method: 'send', threadId: id, text: CONTINUE_PROMPT }]);
  const [onKey] = calls(s, { type: 'resume', threadId: id, onApiKey: true });
  assert.equal(onKey.method === 'start' && onKey.options.useApiKey, true);
  assert.equal(onKey.method === 'start' && onKey.options.resume, 'sess-1');
  assert.equal(run(s, { type: 'resume', threadId: id }).threads.find((t) => t.id === id)!.live?.limit, undefined);

  const handoff: Action = { type: 'handoff', threadId: id, to: 'codex', summary: 'Goal: reply with ok' };
  const [stop, restart] = calls(s, handoff);
  assert.deepEqual(stop, { method: 'stop', threadId: id });
  assert.equal(restart.method === 'start' && restart.options.provider, 'codex');
  assert.equal(restart.method === 'start' && restart.options.prompt, 'Goal: reply with ok');
  assert.equal(restart.method === 'start' && restart.options.resume, undefined, 'a Claude session id never resumes on Codex');
  assert.equal(restart.method === 'start' && restart.options.model, undefined, "main sends the account's default model");
  const handed = run(s, handoff).threads.find((t) => t.id === id)!;
  assert.equal(handed.session, undefined);
  assert.equal(handed.live?.limit, undefined);
});

test("a new thread's model starts at the Settings default, old catalog ids read as provider ids", () => {
  assert.equal(initialControls('claude', '').model, '', "'' is the account default, resolved in main");
  assert.equal(agentOptions(initialControls('codex', ''), 'codex').model, undefined);
  assert.equal(agentOptions(initialControls('codex', 'gpt-6-astra'), 'codex').model, 'gpt-6-astra');
  assert.equal(initialControls('claude', 'sonnet-5.5').model, 'claude-sonnet-5-5');
});

test('a folderless chat starts with no folder (main makes one); a restart reuses the folder the agent first ran in', () => {
  const chat: Action = { type: 'create', title: 'hi', provider: 'claude', project: null, isLive: true };
  const [start] = calls(base(), chat);
  assert.equal(start.method === 'start' && start.options.cwd, null);

  const s = run(base(), { type: 'create', title: 'hi', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const thread = s.threads.at(-1)!;
  assert.deepEqual(thread.repo, { project: 'app', branch: thread.id, path: '/Users/me/dev/app' });
  assert.equal(thread.live?.cwd, '/Users/me/dev/app');
  const [restart] = calls(s, { type: 'resume', threadId: thread.id, onApiKey: true });
  assert.equal(restart.method === 'start' && restart.options.cwd, '/Users/me/dev/app');
});

test('a started agent reads as starting until its first event, so a sent message never looks stuck', () => {
  let s = run(base(), { type: 'create', title: 'reply with ok', provider: 'codex', project: 'harness', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'agent-starting', threadId: id, provider: 'codex' });
  assert.equal(s.threads.at(-1)!.live?.starting, 'codex');
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'codex', sessionId: 'sess-1' });
  assert.equal(s.threads.at(-1)!.live?.starting, undefined);
});

test("a project thread asks main for its worktree; once main reports it, restarts run there, not in the project folder", () => {
  const create: Action = { type: 'create', title: 'hi', provider: 'claude', project: '/Users/me/dev/app', isLive: true };
  const [start] = calls(base(), create);
  let s = run(base(), create);
  const thread = s.threads.at(-1)!;
  assert.equal(start.method === 'start' && start.options.cwd, '/Users/me/dev/app');
  assert.deepEqual(start.method === 'start' && start.options.workspace, { mode: 'worktree', branch: thread.repo!.branch });

  s = applyAgentEvent(s, { threadId: thread.id, type: 'worktree', path: '/Users/me/.harness/worktrees/app/t1' });
  assert.equal(s.threads.at(-1)!.live?.cwd, '/Users/me/.harness/worktrees/app/t1');
  const [restart] = calls(s, { type: 'resume', threadId: thread.id, onApiKey: true });
  assert.equal(restart.method === 'start' && restart.options.cwd, '/Users/me/.harness/worktrees/app/t1');
  assert.equal(restart.method === 'start' && restart.options.workspace, undefined, 'only the first start makes a worktree');
});

test('workspace per mode: a new worktree from a chosen base, an existing branch checked out, a project folder that never gets a worktree', () => {
  const project = '/Users/me/dev/app';
  const startOf = (workspace: WorkspaceDraft) => {
    const create: Action = { type: 'create', title: 'Fix the login bug!', provider: 'claude', project, isLive: true, workspace };
    const [start] = calls(base(), create);
    return { options: start.method === 'start' ? start.options : undefined, thread: run(base(), create).threads.at(-1)! };
  };

  const fresh = startOf({ mode: 'worktree', base: 'origin/release', branch: 'mochi/fix-the-login-bug' });
  assert.deepEqual(fresh.options?.workspace, { mode: 'worktree', branch: 'mochi/fix-the-login-bug', base: 'origin/release' });
  assert.equal(fresh.thread.repo?.base, 'origin/release', 'the Changes tab diffs against the chosen base');

  const existing = startOf({ mode: 'worktree', base: 'main', branch: 'feat/x', isExisting: true });
  assert.deepEqual(existing.options?.workspace, { mode: 'worktree', branch: 'feat/x', isExisting: true }, 'a checked-out branch has no base');

  const folder = startOf({ mode: 'folder', branch: 'main' });
  assert.deepEqual(folder.options?.workspace, { mode: 'folder', branch: 'main' });
  assert.equal(folder.options?.cwd, project);
  // Same thread id in each fresh state: a worktree path on record moves a worktree thread, never a project folder one.
  setWorktreePath(folder.thread.id, '/Users/me/.harness/worktrees/app/t1');
  assert.equal(threadCwd(fresh.thread, true), '/Users/me/.harness/worktrees/app/t1');
  assert.equal(threadCwd(folder.thread, true), project);
  setWorktreePath(folder.thread.id, null);

  const switched = startOf({ mode: 'folder', branch: 'feat/y', isExisting: true });
  assert.deepEqual(switched.options?.workspace, { mode: 'folder', branch: 'feat/y', isExisting: true });

  const scheduled = run(base(), { type: 'create', title: 'nightly', provider: 'claude', project, isLive: true, workspace: { mode: 'folder', branch: 'main' }, schedule: { when: { kind: 'cron', cron: '0 2 * * *' }, missed: 'skip' } });
  const thread = scheduled.threads.at(-1)!;
  assert.equal(isUnstarted(thread), true);
  assert.deepEqual(scheduledStart(thread)?.workspace, { mode: 'folder', branch: 'main' }, 'schedules run where the thread was set to');
  const moved = run(scheduled, { type: 'workspace', threadId: thread.id, workspace: { mode: 'worktree', base: 'dev', branch: 'mochi/nightly' } });
  assert.deepEqual(scheduledStart(moved.threads.at(-1)!)?.workspace, { mode: 'worktree', branch: 'mochi/nightly', base: 'dev' });
});

test('adding a source tells a live agent in your name; a demo thread only logs it, and a duplicate does nothing', () => {
  const create: Action = { type: 'create', title: 'reply with ok', provider: 'claude', project: '/Users/me/dev/harness', isLive: true };
  const [start] = calls(base(), create);
  const s = run(base(), create);
  const add: Action = { type: 'source-add', threadId: start.threadId, source: { kind: 'link', label: 'redis.io/docs' } };
  assert.deepEqual(calls(s, add), [{ method: 'send', threadId: start.threadId, text: 'I added a source to this thread: redis.io/docs. Read it where it helps with the goal.' }]);
  const added = run(s, add).threads.find((t) => t.id === start.threadId)!;
  assert.deepEqual(added.sources, [{ kind: 'link', label: 'redis.io/docs' }]);
  assert.equal(added.activity.at(-1)?.who, 'you');
  assert.equal(calls(run(s, add), add).length, 0, 'already a source');

  const demo = run(base(), { type: 'source-add', threadId: 'adm', source: { kind: 'file', label: 'docs/x.md' } }).threads.find((t) => t.id === 'adm')!;
  assert.deepEqual(demo.activity.at(-1), { at: base().now, who: 'harness', kind: 'event', text: 'Added source docs/x.md' });
  assert.deepEqual(calls(base(), { type: 'source-add', threadId: 'adm', source: { kind: 'file', label: 'docs/x.md' } }), []);
});

test('settling stops the agent once; after reactivating, the next message restarts it with resume instead of sending to a gone process', () => {
  const create: Action = { type: 'create', title: 'reply with ok', provider: 'claude', project: '/Users/me/dev/app', isLive: true };
  let s = run(base(), create);
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 'sess-1' });

  assert.deepEqual(calls(s, { type: 'settle', threadId: id }).filter((c) => c.threadId === id), [{ method: 'stop', threadId: id }]);
  s = run(s, { type: 'settle', threadId: id });
  assert.equal(s.threads.find((t) => t.id === id)!.live?.isDetached, true);
  assert.deepEqual(calls(s, { type: 'settle', threadId: id }), [], 'settling again never stops a process that is already gone');

  s = run(s, { type: 'unsettle', threadId: id });
  const [restart] = calls(s, { type: 'send', threadId: id, text: 'and add a test', drift: 'on-goal', reason: '' });
  assert.equal(restart.method, 'start');
  assert.equal(restart.method === 'start' && restart.options.resume, 'sess-1');
  assert.equal(restart.method === 'start' && restart.options.prompt, 'and add a test');
});

test('a send that finds no agent process restarts the agent with resume, carrying the same message', () => {
  let s = run(base(), { type: 'create', title: 'reply with ok', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 'sess-2' });
  const [again] = resumeAfterLostProcess(s.threads.find((t) => t.id === id)!, { method: 'send', threadId: id, text: 'still there?' });
  assert.equal(again.method === 'start' && again.options.resume, 'sess-2');
  assert.equal(again.method === 'start' && again.options.prompt, 'still there?');
});
