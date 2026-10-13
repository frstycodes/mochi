import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent } from '../host/types/agent.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { dueQueued, queuedMessage } from '../chat/outbox.ts';
import { agentCalls, CONTINUE_PROMPT } from './live.ts';
import { dueResumes, heldBy, limitPhase, nextResumeAt, WRAP_PROMPT } from './limits.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);
const calls = (s: State, action: Action) => agentCalls(s, action, () => threadsReducer(s, action));
const RESET = '2026-10-13T15:40:00.000Z';
const BEFORE = Date.parse(RESET) - 60_000;
const AFTER = Date.parse(RESET) + 1;

function liveThread(provider: 'claude' | 'codex', s = base()) {
  s = run(s, { type: 'create', title: 'reply with ok', provider, project: 'harness', isLive: true });
  const id = s.threads.at(-1)!.id;
  return { s, id, thread: (state: State) => state.threads.find((t) => t.id === id)! };
}

const agent = (s: State, event: AgentEvent): [State, ReturnType<typeof calls>] => {
  const action: Action = { type: 'agent', event };
  return [run(s, action), calls(s, action)];
};

test('approaching → wrapping up → paused → resumed at reset, with simulated Codex limit events', () => {
  let { s, id, thread } = liveThread('codex');
  let sent: ReturnType<typeof calls>;
  const window = (usedPct: number) => ({ id: 'primary', label: '5-hour', usedPct, resetsAt: RESET });

  [s, sent] = agent(s, { threadId: id, type: 'limit-warning', window: window(91) });
  assert.equal(limitPhase(thread(s)), 'approaching');
  assert.deepEqual(sent, [], 'a warning alone sends nothing');
  const warnings = thread(s).activity.filter((e) => e.text.includes('limit is'));
  assert.equal(warnings.length, 1);

  [s, sent] = agent(s, { threadId: id, type: 'limit-warning', window: window(93) });
  assert.equal(thread(s).activity.filter((e) => e.text.includes('limit is')).length, 1, 'each window warns once');

  [s, sent] = agent(s, { threadId: id, type: 'limit-warning', window: window(96) });
  assert.equal(limitPhase(thread(s)), 'wrapping-up');
  assert.deepEqual(sent, [{ method: 'send', threadId: id, text: WRAP_PROMPT }], 'Codex gets Mochi’s wrap-up, steered into the turn');
  [s, sent] = agent(s, { threadId: id, type: 'limit-warning', window: window(98) });
  assert.deepEqual(sent, [], 'asked once per turn');

  s = run(s, { type: 'queued-add', threadId: id, message: queuedMessage('next', { files: 0, mentions: [], isCommand: false, typedSkills: [] }) });
  [s] = agent(s, { threadId: id, type: 'limit', resetsAt: RESET, label: '5-hour' });
  [s] = agent(s, { threadId: id, type: 'turn-end', status: 'failed', error: 'You hit your usage limit.' });
  const paused = thread(s);
  assert.equal(limitPhase(paused), 'paused');
  assert.deepEqual(paused.live?.limit, { resetsAt: RESET, label: '5-hour' });
  assert.equal(paused.queuePause, 'limit', "the limit's own failed turn doesn't relabel the pause");
  assert.equal(paused.status, 'needs-you');
  assert.equal(paused.activity.filter((e) => e.isLimit).length, 1);
  assert.ok(!paused.activity.some((e) => e.text.startsWith('Turn failed')), 'the limit card says it; no second failure line');
  assert.deepEqual(dueQueued(s), [], 'nothing queued starts while paused');

  s = run(s, { type: 'limit-auto-resume', threadId: id, isOn: true });
  assert.equal(thread(s).live?.limit?.autoResume, true);
  assert.deepEqual(dueResumes(s.threads, BEFORE), []);
  assert.equal(nextResumeAt(s.threads, BEFORE), Date.parse(RESET));
  assert.deepEqual(dueResumes(s.threads, AFTER).map((t) => t.id), [id]);

  const resume: Action = { type: 'resume', threadId: id, atReset: true };
  assert.deepEqual(calls(s, resume), [{ method: 'send', threadId: id, text: CONTINUE_PROMPT }], 'same account, never the API key');
  s = run(s, resume);
  assert.equal(limitPhase(thread(s)), undefined);
  assert.equal(thread(s).activity.at(-1)?.text, 'Resumed after the 5-hour limit reset');
});

test('Claude wraps up on its own: the state shows, Mochi sends nothing', () => {
  let { s, id, thread } = liveThread('claude');
  let sent: ReturnType<typeof calls>;
  [s, sent] = agent(s, { threadId: id, type: 'limit-warning', window: { id: 'five_hour', label: '5-hour', usedPct: 97 } });
  assert.equal(limitPhase(thread(s)), 'wrapping-up');
  assert.deepEqual(sent, []);
  [s] = agent(s, { threadId: id, type: 'turn-end', status: 'done' });
  assert.equal(limitPhase(thread(s)), 'approaching', 'the wrap-up ends with its turn; the warning stays');
});

test('a paused account holds every thread on that profile and harness until the reset; other harnesses and API key threads run', () => {
  let { s, id: limited } = liveThread('claude');
  const second = liveThread('claude', s);
  s = second.s;
  const codex = liveThread('codex', s);
  s = codex.s;
  [s] = agent(s, { threadId: limited, type: 'session', provider: 'claude', sessionId: 'sess-1' });
  [s] = agent(s, { threadId: limited, type: 'limit', resetsAt: RESET });
  const find = (id: string) => s.threads.find((t) => t.id === id)!;

  assert.equal(heldBy(s.threads, find(second.id), BEFORE)?.threadId, limited, 'same account: held');
  assert.equal(heldBy(s.threads, find(second.id), AFTER), undefined, 'past the reset: free');
  assert.equal(heldBy(s.threads, find(codex.id), BEFORE), undefined, 'the other harness is another account');
  assert.equal(heldBy(s.threads, find(limited), AFTER)?.threadId, limited, 'the paused thread itself waits for a resume, even past the reset');

  assert.equal(heldBy(s.threads, find('limit'), BEFORE)?.threadId, 'limit', 'the demo thread waits on its own pause…');
  assert.equal(heldBy(s.threads.filter((t) => t.id !== limited), find(second.id), BEFORE), undefined, '…but holds no real thread');

  s = run(s, { type: 'resume', threadId: limited, onApiKey: true });
  assert.equal(heldBy(s.threads, find(limited), BEFORE), undefined, 'on the API key: not held');
});

test('a warning after the limit changes nothing', () => {
  let { s, id, thread } = liveThread('claude');
  [s] = agent(s, { threadId: id, type: 'limit', resetsAt: RESET });
  const before = thread(s);
  [s] = agent(s, { threadId: id, type: 'limit-warning', window: { id: 'five_hour', label: '5-hour', usedPct: 100 } });
  assert.equal(thread(s), before);
});
