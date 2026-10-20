import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent } from '../host/types/agent.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls } from './live.ts';
import { dueWakes, WAKE_PROMPT } from './subThreadNotes.ts';

const run = (s: State, action: Action) => threadsReducer(s, action);
const agent = (s: State, event: AgentEvent) => run(s, { type: 'agent', event });
const ended = (s: State, threadId: string) => agent(s, { threadId, type: 'turn-end', status: 'done' });

function family() {
  let s = { ...initialThreads(undefined, false), ...initialQueue(undefined, false), spaceId: 'latitude', views: {} } as unknown as State;
  const create = (title: string, parentId?: string) => {
    s = run(s, { type: 'create', title, provider: 'claude', project: 'harness', isLive: true, ...(parentId && { parent: { threadId: parentId } }) });
    return s.threads.at(-1)!.id;
  };
  const parent = create('Split the work');
  const [a, b] = [create('Piece A', parent), create('Piece B', parent)];
  return { s, parent, a, b, thread: (state: State, id: string) => state.threads.find((t) => t.id === id)! };
}

test("each turn a sub-thread ends reaches its parent's agent, which wakes once every sub-thread is idle", () => {
  let { s, parent, a, b, thread } = family();
  s = ended(s, parent);
  s = agent(s, { threadId: a, type: 'message', text: 'Piece A is done: added the endpoint.', isDelta: false });
  s = ended(s, a);
  assert.match(thread(s, parent).live?.notes?.[0] ?? '', /^\[Sub-thread "Piece A" .* ended a turn: done\]\nPiece A is done/);
  assert.deepEqual(dueWakes(s), [], 'Piece B is still working');

  s = ended(s, b);
  assert.equal(thread(s, parent).live?.notes?.length, 2);
  assert.deepEqual(dueWakes(s).map((t) => t.id), [parent]);

  const wake: Action = { type: 'subthread-wake', threadId: parent };
  const [call] = agentCalls(s, wake, () => run(s, wake));
  assert.equal(call.method, 'send');
  assert.ok(call.method === 'send' && call.text.includes('"Piece A"') && call.text.includes('"Piece B"') && call.text.endsWith(WAKE_PROMPT));
  s = run(s, wake);
  assert.equal(thread(s, parent).live?.notes, undefined);
  assert.equal(thread(s, parent).live?.isWorking, true);
  assert.deepEqual(dueWakes(s), []);
});

test("a working parent isn't woken; the notes ride with its next message", () => {
  let { s, parent, a } = family();
  s = ended(s, a);
  assert.deepEqual(dueWakes(s), [], 'the parent is mid-turn');
  const send: Action = { type: 'send', threadId: parent, text: 'go on', reason: '' };
  const [call] = agentCalls(s, send, () => run(s, send));
  assert.ok(call.method === 'send' && call.text.startsWith('[Sub-thread "Piece A"') && call.text.endsWith('go on'));
});
