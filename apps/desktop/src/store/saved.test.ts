import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { applyAgentEvent } from '../runtime/apply.ts';
import { agentCalls } from '../runtime/live.ts';
import type { Action, State } from './index.tsx';
import { joinSaved, parseSaved, splitSaved, toSaved } from './saved.ts';
import { initialQueue } from './queue.ts';
import { initialThreads, threadsReducer } from './threads.ts';

const demoState = () =>
  ({
    ...initialThreads(null, true),
    ...initialQueue(null, true),
    spaceId: 'personal',
    views: {},
  }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);

test('a save keeps live threads only and comes back idle, detached and without dead agent requests', () => {
  let s = run(demoState(), {
    type: 'create',
    title: 'add a readme',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'session',
    provider: 'claude',
    sessionId: 'sess-1',
  });
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'approval',
    requestId: 'req-1',
    kind: 'command',
    title: 'Run ls',
    detail: '',
  });
  assert.ok(s.queue.some((q) => q.requestId === 'req-1'));

  const saved = toSaved(s);
  assert.deepEqual(
    saved.threads.map((t) => t.id),
    [id],
    'demo threads are never saved',
  );
  const back = parseSaved(JSON.stringify(saved))!;
  assert.equal(back.seq, s.seq);
  assert.deepEqual(back.queue, [], 'the approval died with the agent process');

  const restored = {
    ...initialThreads(back, false),
    ...initialQueue(back, false),
    spaceId: 'personal',
    views: {},
  } as unknown as State;
  const thread = restored.threads.find((t) => t.id === id)!;
  assert.equal(restored.threads.length, 1, 'no demo threads on desktop');
  const branch = s.threads.find((t) => t.id === id)!.repo!.branch;
  assert.deepEqual(thread.repo, {
    project: 'app',
    branch,
    autoBranch: branch,
    path: '/Users/me/dev/app',
  });
  assert.equal(thread.session?.id, 'sess-1');
  assert.deepEqual(
    [thread.live?.isWorking, thread.live?.isDetached],
    [false, true],
  );
  assert.equal(
    thread.activity.at(-1)?.text,
    'Stopped when Mochi quit. Send a message to continue.',
  );

  const send: Action = {
    type: 'send',
    threadId: id,
    text: 'and a license',
  };
  const [call] = agentCalls(restored, send, () => run(restored, send));
  assert.deepEqual(
    call.method === 'start' && [
      call.options.resume,
      call.options.prompt,
      call.options.cwd,
    ],
    ['sess-1', 'and a license', '/Users/me/dev/app'],
    'the follow-up resumes the saved session',
  );
  assert.deepEqual(
    agentCalls(restored, { type: 'interrupt', threadId: id }, () => restored),
    [],
    'nothing to interrupt before it runs again',
  );

  const sent = run(restored, send);
  assert.equal(
    sent.threads.find((t) => t.id === id)!.live?.isDetached,
    undefined,
  );
  assert.deepEqual(
    agentCalls(sent, send, () => run(sent, send))[0].method,
    'send',
    'once restarted, messages go to the running agent',
  );
});

test('a save that is missing, corrupt or from another version restores nothing', () => {
  assert.equal(parseSaved(null), null);
  assert.equal(parseSaved('{'), null);
  assert.equal(parseSaved('{"version":2,"threads":[],"queue":[]}'), null);
});

test('after a window reload, a thread whose agent still runs in main stays attached and working, its queue not paused', () => {
  let s = run(demoState(), {
    type: 'create',
    title: 'add a readme',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  s = run(s, {
    type: 'agent',
    event: {
      threadId: id,
      type: 'session',
      provider: 'claude',
      sessionId: 'sess-1',
      seq: 41,
    },
  });
  s = run(s, {
    type: 'agent',
    event: {
      threadId: id,
      type: 'approval',
      requestId: 'req-1',
      kind: 'command',
      title: 'Run ls',
      detail: '',
      seq: 42,
    },
  });
  const before = s.threads.find((t) => t.id === id)!;
  s = {
    ...s,
    queue: [
      ...s.queue,
      {
        id: 'q-tool-1',
        kind: 'approval',
        threadId: id,
        blocks: { steps: 0, threads: 1 },
        createdAt: 0,
        title: 'Delete thread',
        detail: '',
        tool: { callId: 'q-tool-1' },
      },
    ],
  };
  s = run(s, {
    type: 'say',
    threadId: id,
    entry: {
      who: 'claude',
      kind: 'event',
      text: 'Delete thread',
      card: { id: 'q-tool-1', isOpen: true },
    },
  });
  assert.equal(
    before.live?.eventSeq,
    42,
    'the last event applied is saved, so a reload asks main for the ones after it',
  );
  const back = parseSaved(JSON.stringify(toSaved(s)), new Map([[id, true]]))!;
  const thread = back.threads[0];
  assert.deepEqual(
    [thread.live?.isWorking, thread.live?.isDetached],
    [true, false],
  );
  assert.equal(
    thread.activity.length,
    before.activity.length,
    'no "Stopped when Mochi quit" line',
  );
  assert.ok(
    back.queue.some((q) => q.requestId === 'req-1'),
    'main still waits on the approval',
  );
  assert.ok(
    !back.queue.some((q) => q.tool) && !thread.activity.some((e) => e.card),
    'the reloaded page runs the Mochi call again and asks anew',
  );
});

test('an overlap card or a step an overlap held, saved before overlaps were removed, comes back as nothing and up next', () => {
  let s = run(demoState(), {
    type: 'create',
    title: 'add a readme',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'session',
    provider: 'claude',
    sessionId: 'sess-1',
  });
  const saved = toSaved(s);
  const held = {
    id: 's1',
    title: 'Run tests',
    status: 'waiting',
    addedAt: 0,
    addedBy: 'claude',
    footprint: [],
    sharedKey: 'shared-x',
  };
  const old = {
    ...saved,
    threads: saved.threads.map((t) => ({ ...t, steps: [held] })),
    queue: [
      {
        id: 'q-overlap-1',
        kind: 'overlap',
        threadId: id,
        title: 'Two threads want to run tests',
        detail: '',
        blocks: { steps: 1, threads: 2 },
        createdAt: 0,
      },
    ],
  };
  const back = parseSaved(JSON.stringify(old))!;
  assert.deepEqual(initialQueue(back, false).queue, []);
  assert.equal(
    initialThreads(back, false).threads.find((t) => t.id === id)!.steps[0]
      .status,
    'ready',
  );
});

test('a thread saved while goals existed loads, its goal fields dropped', () => {
  const s = run(demoState(), {
    type: 'create',
    title: 'add a readme',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  const saved = toSaved(s);
  const message = { at: 1, who: 'you', kind: 'message', text: 'go' };
  const old = {
    ...saved,
    threads: saved.threads.map((t) => ({
      ...t,
      goal: 'A readme exists',
      criteria: [{ id: 'c1', text: 'README.md', command: 'ls README.md' }],
      similar: [{ threadId: 'x', relation: 'same' }],
      isGoalOff: false,
      revisions: [{ n: 1, at: 0, label: 'Goal set', by: 'you' }],
      drift: { isMuted: true, keeps: 2 },
      parent: { threadId: 'p', criterionId: 'c1' },
      idle: { at: 1, accepted: ['g1'], uncommitted: 2, isConfirmed: true },
      activity: [{ ...message, drift: 'off-goal' }],
    })),
  };
  const back = parseSaved(JSON.stringify(old));
  assert.ok(back, 'the save still loads');
  const thread = back.threads.find((t) => t.id === id)!;
  for (const key of [
    'goal',
    'criteria',
    'similar',
    'isGoalOff',
    'revisions',
    'drift',
  ])
    assert.equal(key in thread, false, key);
  assert.deepEqual(thread.parent, { threadId: 'p' });
  assert.deepEqual(JSON.parse(JSON.stringify(thread.idle)), { at: 1 });
  assert.deepEqual(thread.activity[0], message);
});

test('a save splits into an index and a file per thread, re-encodes only changed threads, and joins back whole', () => {
  let s = run(demoState(), {
    type: 'create',
    title: 'add a readme',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  s = run(s, {
    type: 'create',
    title: 'fix the build',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const [a, b] = toSaved(s).threads.map((t) => t.id);
  s = { ...s, forks: { [b]: { parentId: a, at: 1, label: 'Fork' } } };
  const saved = toSaved(s);
  const first = splitSaved(saved);
  assert.deepEqual(Object.keys(first.threads), [a, b]);
  assert.ok(!first.index.includes('"activity"'), 'the index holds no thread');
  assert.deepEqual(
    joinSaved({ index: first.index, threads: Object.values(first.threads) }),
    plain(saved),
  );
  assert.deepEqual(
    joinSaved({
      index: first.index,
      threads: [first.threads[a]!, '{"thread":{"id":3}}'],
    })!.threads.map((t) => t.id),
    [a],
    'a file that is no SavedThread costs that thread',
  );
  assert.equal(
    joinSaved({ index: '{"version":2,"threadIds":[]}', threads: [] }),
    null,
    'an index this version can’t read loads as nothing, never as an empty save',
  );

  s = applyAgentEvent(s, {
    threadId: b,
    type: 'session',
    provider: 'claude',
    sessionId: 'sess-b',
  });
  const second = splitSaved(toSaved(s));
  assert.equal(
    second.threads[a],
    first.threads[a],
    'the unchanged thread is the same string, not a re-encoding',
  );
  assert.notEqual(second.threads[b], first.threads[b]);
});

test('a one-document threads.json from before the split loads as the index', () => {
  const s = run(demoState(), {
    type: 'create',
    title: 'add a readme',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const saved = toSaved(s);
  assert.deepEqual(
    joinSaved({ index: JSON.stringify(saved), threads: [] }),
    plain(saved),
  );
});

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
