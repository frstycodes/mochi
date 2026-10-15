import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAgentEvent } from '../runtime/apply.ts';
import { agentCalls } from '../runtime/live.ts';
import type { Action, State } from './index.tsx';
import { parseSaved, toSaved } from './persist.ts';
import { initialQueue } from './queue.ts';
import { initialThreads, threadsReducer } from './threads.ts';

const demoState = () => ({ ...initialThreads(null, true), ...initialQueue(null, true), spaceId: 'personal', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);

test('a save keeps live threads only and comes back idle, detached and without dead agent requests', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 'sess-1' });
  s = applyAgentEvent(s, { threadId: id, type: 'approval', requestId: 'req-1', kind: 'command', title: 'Run ls', detail: '' });
  assert.ok(s.queue.some((q) => q.requestId === 'req-1'));

  const saved = toSaved(s);
  assert.deepEqual(saved.threads.map((t) => t.id), [id], 'demo threads are never saved');
  const back = parseSaved(JSON.stringify(saved))!;
  assert.equal(back.seq, s.seq);
  assert.deepEqual(back.queue, [], 'the approval died with the agent process');

  const restored = { ...initialThreads(back, false), ...initialQueue(back, false), spaceId: 'personal', views: {} } as unknown as State;
  const thread = restored.threads.find((t) => t.id === id)!;
  assert.equal(restored.threads.length, 1, 'no demo threads on desktop');
  assert.deepEqual(thread.repo, { project: 'app', branch: id, path: '/Users/me/dev/app' });
  assert.equal(thread.session?.id, 'sess-1');
  assert.deepEqual([thread.live?.isWorking, thread.live?.isDetached], [false, true]);
  assert.equal(thread.activity.at(-1)?.text, 'Stopped when Mochi quit. Send a message to continue.');

  const send: Action = { type: 'send', threadId: id, text: 'and a license', drift: 'on-goal', reason: '' };
  const [call] = agentCalls(restored, send, () => run(restored, send));
  assert.deepEqual(call.method === 'start' && [call.options.resume, call.options.prompt, call.options.cwd], ['sess-1', 'and a license', '/Users/me/dev/app'], 'the follow-up resumes the saved session');
  assert.deepEqual(agentCalls(restored, { type: 'interrupt', threadId: id }, () => restored), [], 'nothing to interrupt before it runs again');

  const sent = run(restored, send);
  assert.equal(sent.threads.find((t) => t.id === id)!.live?.isDetached, undefined);
  assert.deepEqual(agentCalls(sent, send, () => run(sent, send))[0].method, 'send', 'once restarted, messages go to the running agent');
});

test('a save that is missing, corrupt or from another version restores nothing', () => {
  assert.equal(parseSaved(null), null);
  assert.equal(parseSaved('{'), null);
  assert.equal(parseSaved('{"version":2,"threads":[],"queue":[]}'), null);
});

test('after a window reload, a thread whose agent still runs in main stays attached and working, its queue not paused', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'agent', event: { threadId: id, type: 'session', provider: 'claude', sessionId: 'sess-1', seq: 41 } });
  s = run(s, { type: 'agent', event: { threadId: id, type: 'approval', requestId: 'req-1', kind: 'command', title: 'Run ls', detail: '', seq: 42 } });
  const before = s.threads.find((t) => t.id === id)!;
  assert.equal(before.live?.eventSeq, 42, 'the last event applied is saved, so a reload asks main for the ones after it');
  const back = parseSaved(JSON.stringify(toSaved(s)), new Map([[id, true]]))!;
  const thread = back.threads[0];
  assert.deepEqual([thread.live?.isWorking, thread.live?.isDetached], [true, false]);
  assert.equal(thread.activity.length, before.activity.length, 'no "Stopped when Mochi quit" line');
  assert.ok(back.queue.some((q) => q.requestId === 'req-1'), 'main still waits on the approval');
});
