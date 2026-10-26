import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls } from './live.ts';
import { moveNote } from './move.ts';
import '../host/cwd.ts';

const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;
const run = (s: State, ...actions: Action[]) =>
  actions.reduce((x, a) => threadsReducer(x, a), s);
const calls = (s: State, action: Action) =>
  agentCalls(s, action, () => threadsReducer(s, action));

const SESSION = '03773868-7457-443a-b076-64735ee88874';
const PROJECT = '/Users/me/dev/harness';

/** A live folderless chat whose Claude session ran one turn and is idle. */
function idleChat() {
  let s = run(base(), {
    type: 'create',
    title: 'plan the trip',
    provider: 'claude',
    project: null,
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  s = run(
    s,
    {
      type: 'agent',
      event: {
        threadId: id,
        type: 'session',
        provider: 'claude',
        sessionId: SESSION,
      },
      ms: 0,
    },
    {
      type: 'agent',
      event: { threadId: id, type: 'turn-end', status: 'done' },
      ms: 0,
    },
  );
  return { s, id };
}

const attach = (threadId: string): Action => ({
  type: 'attach-project',
  threadId,
  project: PROJECT,
});

test('only an idle folderless chat attaches to a project', () => {
  const { s, id } = idleChat();
  const working = run(s, {
    type: 'send',
    threadId: id,
    text: 'more',
    reason: '',
  });
  assert.equal(run(working, attach(id)).threads.at(-1)!.repo, null);

  const moved = run(s, attach(id));
  const thread = moved.threads.find((t) => t.id === id)!;
  assert.equal(thread.repo?.path, PROJECT);
  assert.equal(thread.repo?.project, 'harness');
  assert.equal(thread.live?.isDetached, true);
  assert.equal(thread.live?.movedFrom, `~/.harness/chats/${id}`);

  const other = run(moved, {
    type: 'attach-project',
    threadId: id,
    project: '/Users/me/dev/other',
  });
  assert.equal(other.threads.find((t) => t.id === id)!.repo?.path, PROJECT);
});

test('the move makes the folder in main and carries the session; the next message resumes it there with the note once', () => {
  const { s, id } = idleChat();
  const [move] = calls(s, attach(id));
  assert.equal(move.method, 'move');
  const options = move.method === 'move' ? move.options : undefined;
  assert.equal(options?.provider, 'claude');
  assert.equal(options?.cwd, PROJECT);
  assert.equal(options?.sessionId, SESSION);
  assert.equal(options?.workspace.mode, 'worktree');
  assert.equal(options?.workspace.isNew, true);
  assert.equal(options?.workspace.title, 'plan the trip');
  assert.deepEqual(calls(run(s, attach(id)), attach(id)), []);

  const moved = run(s, attach(id), {
    type: 'agent',
    event: { threadId: id, type: 'worktree', path: '/wt/harness/new-1' },
    ms: 0,
  });
  const send: Action = { type: 'send', threadId: id, text: 'go', reason: '' };
  const [start] = calls(moved, send);
  assert.equal(start.method, 'start');
  if (start.method !== 'start') return;
  assert.equal(start.options.resume, SESSION);
  assert.equal(start.options.cwd, PROJECT);
  assert.equal(start.options.workspace?.mode, 'worktree');
  assert.equal(
    start.options.prompt,
    `${moveNote('harness', '/wt/harness/new-1', `~/.harness/chats/${id}`)}\n\ngo`,
  );

  const after = run(moved, send);
  assert.equal(
    after.threads.find((t) => t.id === id)!.live?.movedFrom,
    undefined,
  );
});

test("an agent's move waits for its turn to end", () => {
  const { s, id } = idleChat();
  const working = run(s, {
    type: 'send',
    threadId: id,
    text: 'move this',
    reason: '',
  });
  const queued = run(working, {
    type: 'attach-project-queued',
    threadId: id,
    project: PROJECT,
  });
  const thread = queued.threads.find((t) => t.id === id)!;
  assert.equal(thread.repo, null);
  assert.equal(thread.live?.moveTo, PROJECT);
  const done = run(queued, {
    type: 'agent',
    event: { threadId: id, type: 'turn-end', status: 'done' },
    ms: 0,
  });
  const moved = run(done, attach(id)).threads.find((t) => t.id === id)!;
  assert.equal(moved.repo?.path, PROJECT);
  assert.equal(moved.live?.moveTo, undefined);
});
