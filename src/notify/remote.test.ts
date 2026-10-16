import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StreamFrame } from '../host/types/remote.ts';
import type { AgentEvent } from '../host/types/agent.ts';
import { applyFrame, type Mirror } from '../remote/mirror.ts';
import type { Action } from '../store/index.tsx';
import { toSaved } from '../store/persist.ts';
import { mirrorState, reducer } from '../store/root.ts';
import { alertsToShow, baselineOf, remoteAlerts, type RemoteAlert, type RemoteBaseline } from './remote.ts';

/** Another computer with one live thread, its stream as frames. */
function machine() {
  let state = reducer(mirrorState({ version: 1, now: 900, seq: 1, threads: [], queue: [], checkpoints: {}, checkpointSeq: 0, forks: {} }), { type: 'create', title: 'Fix login', provider: 'claude', project: null, isLive: true, isBackground: true });
  const threadId = state.threads[0].id;
  let seq = 0;
  let eventSeq = 0;
  const act = (action: Action): StreamFrame => {
    state = reducer(state, action);
    return { type: 'action', epoch: 'e1', seq: ++seq, action: JSON.parse(JSON.stringify(action)) };
  };
  const agent = (event: AgentEvent) => act({ type: 'agent', event: { ...event, seq: ++eventSeq } });
  const snapshot = (): StreamFrame => ({ type: 'snapshot', epoch: 'e1', seq, saved: JSON.parse(JSON.stringify(toSaved(state))) });
  return { act, agent, snapshot, threadId };
}

/** This computer following it: each frame lands in the mirror, and the alerts it raises against the kept baseline are collected. */
function follower() {
  let mirror: Mirror | undefined;
  let baseline: RemoteBaseline | undefined;
  const alerts: string[] = [];
  const receive = (frame: StreamFrame) => {
    mirror = applyFrame(mirror, frame);
    if (!mirror) return;
    alerts.push(...remoteAlerts(baseline, mirror.state).map((a) => a.kind));
    baseline = baselineOf(mirror.state);
  };
  return { receive, alerts, reconnect: () => (mirror = undefined) };
}

test('each ask, failure and finished turn alerts once, across a reconnect’s snapshot and replayed actions', () => {
  const m = machine();
  const f = follower();
  f.receive(m.snapshot());
  const frames = [
    m.act({ type: 'send', threadId: m.threadId, text: 'Go', reason: '' }),
    m.agent({ threadId: m.threadId, type: 'approval', requestId: 'r1', kind: 'command', title: 'Run tests', detail: 'pnpm test' }),
  ];
  frames.forEach(f.receive);
  assert.deepEqual(f.alerts, ['needs-you'], 'the approval');

  // The connection drops and comes back: a fresh snapshot, then the same actions again.
  f.reconnect();
  f.receive(m.snapshot());
  frames.forEach(f.receive);
  assert.deepEqual(f.alerts, ['needs-you'], 'nothing new to say');

  const failed = m.agent({ threadId: m.threadId, type: 'turn-end', status: 'failed', error: 'boom' });
  f.receive(failed);
  f.receive(failed);
  f.reconnect();
  f.receive(m.snapshot());
  assert.deepEqual(f.alerts, ['needs-you', 'failed']);
});

test('the first look at a machine only sets the baseline', () => {
  const m = machine();
  m.act({ type: 'send', threadId: m.threadId, text: 'Go', reason: '' });
  m.agent({ threadId: m.threadId, type: 'question', requestId: 'q1', questions: [{ text: 'Which?', options: ['A', 'B'], multiSelect: false }] });
  const f = follower();
  f.receive(m.snapshot());
  assert.deepEqual(f.alerts, []);
});

test('a turn that ended while this computer was away still alerts, once', () => {
  const m = machine();
  const f = follower();
  f.receive(m.snapshot());
  f.receive(m.act({ type: 'send', threadId: m.threadId, text: 'Go', reason: '' }));
  f.reconnect();
  m.agent({ threadId: m.threadId, type: 'turn-end', status: 'done' });
  f.receive(m.snapshot());
  f.receive(m.snapshot());
  assert.deepEqual(f.alerts, ['done']);
});

test('a stop you made is no news', () => {
  const m = machine();
  const f = follower();
  f.receive(m.snapshot());
  f.receive(m.act({ type: 'send', threadId: m.threadId, text: 'Go', reason: '' }));
  f.receive(m.agent({ threadId: m.threadId, type: 'turn-end', status: 'interrupted' }));
  assert.deepEqual(f.alerts, []);
});

test('quiet hours and the kind switches hold another computer’s alerts back', () => {
  const alerts = [
    { id: 'a', kind: 'needs-you', threadId: 't', title: 'Fix login needs you', body: 'Run tests' },
    { id: 'b', kind: 'done', threadId: 't', title: 'Fix login', body: 'Turn finished' },
  ] satisfies RemoteAlert[];
  const at = (hour: number) => new Date(2026, 9, 16, hour);
  const quiet = { isOn: true, start: 22, end: 8 };
  assert.deepEqual(alertsToShow(alerts, { kinds: ['needs-you', 'done'], quiet }, at(23)), []);
  assert.deepEqual(alertsToShow(alerts, { kinds: ['needs-you', 'done'], quiet }, at(3)), []);
  assert.deepEqual(alertsToShow(alerts, { kinds: ['needs-you'], quiet }, at(12)).map((a) => a.id), ['a']);
  assert.deepEqual(alertsToShow(alerts, { kinds: ['needs-you', 'done'], quiet: { ...quiet, isOn: false } }, at(23)).length, 2);
});
