import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueueItem } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { runRemoteCommand } from './commands.ts';
import { tapAction } from './tap.ts';

function machine() {
  const base = { ...initialThreads(undefined, false), ...initialQueue(undefined, false), spaceId: 'latitude', views: {} } as unknown as State;
  const s = threadsReducer(base, { type: 'create', title: 'reply with ok', provider: 'claude', project: null, isLive: true });
  const threadId = s.threads.at(-1)!.id;
  // Its first turn is over: the agent is idle.
  const threads = s.threads.map((t) => (t.id === threadId ? { ...t, live: { ...t.live!, isWorking: false } } : t));
  const item = (id: string) => ({ id, threadId, kind: 'approval', title: 'Run pnpm test', detail: '', requestId: id }) as QueueItem;
  return { state: { ...s, threads, queue: [item('q-1'), item('q-2')] }, threadId };
}

const device = (state: Pick<State, 'threads' | 'queue'>, deviceName: string, dispatched: Action[]) => ({ state, dispatch: (a: Action) => void dispatched.push(a), deviceName, whileWorking: 'queue' as const });

test('the first answer to a queue item wins; a later one, even against the same stale store, hears where it went', async () => {
  const { state } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-1' }, device(state, 'Laptop', dispatched)), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-1', answers: [['no']] }, device(state, 'Desk PC', dispatched)), { isOk: false, error: 'Already answered on Laptop' });
  assert.deepEqual(dispatched, [{ type: 'answer', queueId: 'q-1', answers: undefined }], 'only the first answer reached the store');
});

test('an answer given on the machine itself wins over a device', async () => {
  const { state } = machine();
  // What the store tap sees when the machine's own Queue answers.
  tapAction({ type: 'answer', queueId: 'q-2' });
  const dispatched: Action[] = [];
  const result = await runRemoteCommand({ type: 'resolve', queueId: 'q-2' }, device(state, 'Laptop', dispatched));
  assert.equal(result.isOk, false);
  assert.match(!result.isOk ? result.error : '', /^Already answered on /);
  assert.deepEqual(dispatched, []);
});

test('an item that is gone, a missing thread and an idle agent are refused without touching the store', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-gone' }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'This is no longer waiting for an answer' });
  assert.deepEqual(await runRemoteCommand({ type: 'interrupt', threadId: 'nope' }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'No such thread on this machine' });
  assert.deepEqual(await runRemoteCommand({ type: 'interrupt', threadId }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'The agent isn’t working' });
  assert.deepEqual(dispatched, []);
});

test('a device answers only approvals and questions, and a question needs answers', async () => {
  const { state, threadId } = machine();
  const review = { id: 'q-review', threadId, kind: 'review', title: 'Review', detail: '' } as QueueItem;
  const question = { id: 'q-ask', threadId, kind: 'question', title: 'Which?', detail: '', requestId: 'ask' } as QueueItem;
  const withItems = { ...state, queue: [...state.queue, review, question] };
  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-review' }, device(withItems, 'Laptop', dispatched)), { isOk: false, error: 'Only approvals and questions can be answered from a device' });
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-ask' }, device(withItems, 'Laptop', dispatched)), { isOk: false, error: 'A question needs answers' });
  assert.deepEqual(dispatched, []);
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-ask', answers: [['A']] }, device(withItems, 'Laptop', dispatched)), { isOk: true });
});

test('send goes out now to an idle agent and queues behind a working one, like the composer', async () => {
  const { state, threadId } = machine();
  const idle: Action[] = [];
  await runRemoteCommand({ type: 'send', threadId, text: 'hello' }, device(state, 'Laptop', idle));
  assert.deepEqual(idle.map((a) => a.type), ['send']);
  const working = { ...state, threads: state.threads.map((t) => (t.id === threadId ? { ...t, live: { ...t.live!, isWorking: true } } : t)) };
  const queued: Action[] = [];
  await runRemoteCommand({ type: 'send', threadId, text: 'next' }, device(working, 'Laptop', queued));
  assert.deepEqual(queued.map((a) => a.type), ['queued-add']);
});

test('operate and manage commands dispatch the same actions the UI does, and the reducer applies them', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  for (const command of [
    { type: 'rename', threadId, title: 'Ship the login fix' },
    { type: 'edit-goal', threadId, goal: 'Login works with SSO' },
    { type: 'pin', threadId, isPinned: true },
    { type: 'fork', threadId, point: { kind: 'message', index: 0 } },
    // A live thread handed off starts working again, so settling comes after.
    { type: 'handoff', threadId, to: 'codex' },
    { type: 'settle', threadId, isSettled: true },
    { type: 'create', title: 'Write the changelog', provider: 'codex', project: null },
  ] as const)
    assert.deepEqual(await runRemoteCommand(command, env), { isOk: true }, command.type);
  assert.deepEqual(dispatched.map((a) => a.type), ['rename', 'edit-goal', 'reorder', 'fork', 'handoff', 'settle', 'create']);

  const applied = dispatched.reduce((s, a) => threadsReducer(s, a), state as State);
  const thread = applied.threads.find((t) => t.id === threadId)!;
  assert.equal(thread.title, 'Ship the login fix');
  assert.equal(thread.goal, 'Login works with SSO');
  assert.equal(thread.status, 'settled');
  assert.equal(thread.providers[0], 'codex');
  assert.ok(applied.threads.some((t) => t.title === 'Write the changelog'), 'the new thread exists');
  const create = dispatched.at(-1) as Extract<Action, { type: 'create' }>;
  assert.equal(create.isBackground, true, 'a device never moves the view on this machine');
});

test('commands that would change nothing say so or do nothing', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  assert.deepEqual(await runRemoteCommand({ type: 'handoff', threadId, to: 'claude' }, env), { isOk: false, error: 'The thread is already on that agent' });
  assert.deepEqual(await runRemoteCommand({ type: 'pin', threadId, isPinned: false }, env), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'settle', threadId, isSettled: false }, env), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'rename', threadId: 'nope', title: 'x' }, env), { isOk: false, error: 'No such thread on this machine' });
  assert.deepEqual(dispatched, []);
});
