import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent } from '../host/types/agent.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { dueQueued, queuedMessage } from '../chat/outbox.ts';
import { agentCalls, CONTINUE_PROMPT } from './live.ts';
import { dueResumes, nextResumeAt } from './limits.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);
const calls = (s: State, action: Action) => agentCalls(s, action, () => threadsReducer(s, action));
const RESET = '2026-10-13T15:40:00.000Z';
const BEFORE = Date.parse(RESET) - 60_000;
const AFTER = Date.parse(RESET) + 1;
const NEXT = queuedMessage('next', { files: 0, mentions: [], isCommand: false, typedSkills: [] });

function liveThread(provider: 'claude' | 'codex') {
  const s = run(base(), { type: 'create', title: 'reply with ok', provider, project: 'harness', isLive: true });
  const id = s.threads.at(-1)!.id;
  return { s, id, thread: (state: State) => state.threads.find((t) => t.id === id)! };
}

const agent = (s: State, event: AgentEvent): [State, ReturnType<typeof calls>] => {
  const action: Action = { type: 'agent', event };
  return [run(s, action), calls(s, action)];
};

test('Claude: a rejected window leaves the turn to Claude Code, which continues it after the reset; Mochi sends nothing', () => {
  let { s, id, thread } = liveThread('claude');
  let sent: ReturnType<typeof calls>;
  [s, sent] = agent(s, { threadId: id, type: 'limit-notice', text: "Claude's 5-hour limit is 92% used" });
  assert.equal(thread(s).activity.at(-1)?.text, "Claude's 5-hour limit is 92% used");
  assert.deepEqual(sent, []);

  s = run(s, { type: 'queued-add', threadId: id, message: NEXT });
  [s, sent] = agent(s, { threadId: id, type: 'limit', resetsAt: RESET, label: '5-hour', isTurnHeld: true });
  assert.deepEqual(sent, []);
  assert.equal(thread(s).live?.isWorking, true, 'the turn is still Claude Code’s');
  assert.deepEqual(thread(s).live?.limit, { resetsAt: RESET, label: '5-hour', isTurnHeld: true });
  assert.notEqual(thread(s).status, 'needs-you', 'nothing for you to do');
  assert.deepEqual(dueQueued(s), [], 'the queue waits for the held turn like any turn');

  [s] = agent(s, { threadId: id, type: 'limit-cleared' });
  assert.equal(thread(s).live?.limit, undefined);
  assert.equal(thread(s).activity.at(-1)?.text, 'The limit reset; the turn continues');
  assert.deepEqual(dueResumes(s.threads, AFTER), [], 'never resumed by Mochi');
});

test('Claude: stopping a held turn ends its limit with it', () => {
  let { s, id, thread } = liveThread('claude');
  [s] = agent(s, { threadId: id, type: 'limit', resetsAt: RESET, isTurnHeld: true });
  [s] = agent(s, { threadId: id, type: 'turn-end', status: 'interrupted' });
  assert.equal(thread(s).live?.limit, undefined);
});

test('Codex: the turn ended; the thread waits for you, and Resume at reset sends the continue prompt then, on the same account', () => {
  let { s, id, thread } = liveThread('codex');
  s = run(s, { type: 'queued-add', threadId: id, message: NEXT });
  [s] = agent(s, { threadId: id, type: 'limit', resetsAt: RESET, label: '5-hour' });
  [s] = agent(s, { threadId: id, type: 'turn-end', status: 'failed', error: 'You hit your usage limit.' });
  const stopped = thread(s);
  assert.equal(stopped.live?.isWorking, false);
  assert.equal(stopped.status, 'needs-you');
  assert.equal(stopped.queuePause, 'limit', "the limit's own failed turn doesn't relabel the pause");
  assert.ok(!stopped.activity.some((e) => e.text.startsWith('Turn failed')), 'the limit card says it; no second failure line');
  assert.deepEqual(dueQueued(s), []);

  assert.deepEqual(dueResumes(s.threads, AFTER), [], 'nothing resumes unless you chose it');
  s = run(s, { type: 'limit-auto-resume', threadId: id, isOn: true });
  assert.deepEqual(dueResumes(s.threads, BEFORE), []);
  assert.equal(nextResumeAt(s.threads, BEFORE), Date.parse(RESET));
  assert.deepEqual(dueResumes(s.threads, AFTER).map((t) => t.id), [id]);

  const resume: Action = { type: 'resume', threadId: id, atReset: true };
  assert.deepEqual(calls(s, resume), [{ method: 'send', threadId: id, text: CONTINUE_PROMPT }], 'same account, never the API key');
  s = run(s, resume);
  assert.equal(thread(s).live?.limit, undefined);
  assert.equal(thread(s).activity.at(-1)?.text, 'Resumed after the 5-hour limit reset');
});

test('Codex: your own message or settling cancels Resume at reset', () => {
  const start = liveThread('codex');
  let [s] = agent(start.s, { threadId: start.id, type: 'limit', resetsAt: RESET });
  s = run(s, { type: 'limit-auto-resume', threadId: start.id, isOn: true });
  assert.deepEqual(dueResumes(run(s, { type: 'send', threadId: start.id, text: 'try again', reason: '' }).threads, AFTER), []);
  assert.deepEqual(dueResumes(run(s, { type: 'settle', threadId: start.id }).threads, AFTER), []);
});
