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

test('the first answer to a queue item wins; a later one, even against the same stale store, hears where it went', () => {
  const { state } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(runRemoteCommand({ type: 'resolve', queueId: 'q-1' }, device(state, 'Laptop', dispatched)), { isOk: true });
  assert.deepEqual(runRemoteCommand({ type: 'resolve', queueId: 'q-1', answers: [['no']] }, device(state, 'Desk PC', dispatched)), { isOk: false, error: 'Already answered on Laptop' });
  assert.deepEqual(dispatched, [{ type: 'answer', queueId: 'q-1', answers: undefined }], 'only the first answer reached the store');
});

test('an answer given on the machine itself wins over a device', () => {
  const { state } = machine();
  // What the store tap sees when the machine's own Queue answers.
  tapAction({ type: 'answer', queueId: 'q-2' });
  const dispatched: Action[] = [];
  const result = runRemoteCommand({ type: 'resolve', queueId: 'q-2' }, device(state, 'Laptop', dispatched));
  assert.equal(result.isOk, false);
  assert.match(!result.isOk ? result.error : '', /^Already answered on /);
  assert.deepEqual(dispatched, []);
});

test('an item that is gone, a missing thread and an idle agent are refused without touching the store', () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(runRemoteCommand({ type: 'resolve', queueId: 'q-gone' }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'This is no longer waiting for an answer' });
  assert.deepEqual(runRemoteCommand({ type: 'interrupt', threadId: 'nope' }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'No such thread on this machine' });
  assert.deepEqual(runRemoteCommand({ type: 'interrupt', threadId }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'The agent isn’t working' });
  assert.deepEqual(dispatched, []);
});

test('a device answers only approvals and questions, and a question needs answers', () => {
  const { state, threadId } = machine();
  const review = { id: 'q-review', threadId, kind: 'review', title: 'Review', detail: '' } as QueueItem;
  const question = { id: 'q-ask', threadId, kind: 'question', title: 'Which?', detail: '', requestId: 'ask' } as QueueItem;
  const withItems = { ...state, queue: [...state.queue, review, question] };
  const dispatched: Action[] = [];
  assert.deepEqual(runRemoteCommand({ type: 'resolve', queueId: 'q-review' }, device(withItems, 'Laptop', dispatched)), { isOk: false, error: 'Only approvals and questions can be answered from a device' });
  assert.deepEqual(runRemoteCommand({ type: 'resolve', queueId: 'q-ask' }, device(withItems, 'Laptop', dispatched)), { isOk: false, error: 'A question needs answers' });
  assert.deepEqual(dispatched, []);
  assert.deepEqual(runRemoteCommand({ type: 'resolve', queueId: 'q-ask', answers: [['A']] }, device(withItems, 'Laptop', dispatched)), { isOk: true });
});

test('send goes out now to an idle agent and queues behind a working one, like the composer', () => {
  const { state, threadId } = machine();
  const idle: Action[] = [];
  runRemoteCommand({ type: 'send', threadId, text: 'hello' }, device(state, 'Laptop', idle));
  assert.deepEqual(idle.map((a) => a.type), ['send']);
  const working = { ...state, threads: state.threads.map((t) => (t.id === threadId ? { ...t, live: { ...t.live!, isWorking: true } } : t)) };
  const queued: Action[] = [];
  runRemoteCommand({ type: 'send', threadId, text: 'next' }, device(working, 'Laptop', queued));
  assert.deepEqual(queued.map((a) => a.type), ['queued-add']);
});
