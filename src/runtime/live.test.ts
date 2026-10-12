import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent } from './apply.ts';
import { agentCalls, CONTINUE_PROMPT } from './live.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const calls = (s: State, action: Action) => agentCalls(s, action, () => threadsReducer(s, action));
const run = (s: State, action: Action) => threadsReducer(s, action);

test('a live new thread starts its agent, follow-ups send, stop interrupts; demo threads never reach host.agent', () => {
  const create: Action = { type: 'create', title: 'reply with ok', provider: 'claude', project: 'harness', isLive: true, controls: { model: 'sonnet-5.5', effort: 'Low', access: 'Ask first' } };
  let s = base();
  const [start] = calls(s, create);
  assert.equal(start.method, 'start');
  assert.deepEqual(start.method === 'start' && start.options, { provider: 'claude', spaceId: 'latitude', cwd: '.', prompt: 'reply with ok', model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'default' });

  s = run(s, create);
  const id = start.threadId;
  const thread = s.threads.find((t) => t.id === id)!;
  assert.deepEqual(thread.steps, [], 'no demo placeholder steps on a live thread');
  assert.equal(thread.live?.isWorking, true);
  assert.equal(run(s, { type: 'tick' }).threads.find((t) => t.id === id)!.activity.length, thread.activity.length, 'the demo tick leaves live threads alone');

  assert.deepEqual(calls(s, { type: 'send', threadId: id, text: 'Queued: and add a test', drift: 'on-goal', reason: '' }), [{ method: 'send', threadId: id, text: 'and add a test' }]);
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
  const handed = run(s, handoff).threads.find((t) => t.id === id)!;
  assert.equal(handed.session, undefined);
  assert.equal(handed.live?.limit, undefined);
});
