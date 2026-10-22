import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentPlanItem } from '../host/types/agent.ts';
import type { Step } from '../model.ts';
import type { State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { planDuration } from '../progress.ts';
import { isPlanComplete, planItems, stepElapsedMs } from './plan.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const step = (rest: Partial<Step>): Step => ({ id: 's', title: 's', status: 'running', addedAt: 0, addedBy: 'claude', ...rest });

test('plan durations read in seconds under a minute, never "<1m"', () => {
  assert.equal(planDuration(0, true), '0s');
  assert.equal(planDuration(59_999, true), '59s');
  assert.equal(planDuration(59_000, false), '59s');
  assert.equal(planDuration(60_000, true), '1m 00s');
  assert.equal(planDuration(65_000, true), '1m 05s');
  assert.equal(planDuration(65_000, false), '1m');
  assert.equal(planDuration(3_599_000, true), '59m 59s');
  assert.equal(planDuration(3_599_000, false), '59m');
  assert.equal(planDuration(3_600_000, true), '1h 0m');
  assert.equal(planDuration(3_600_000, false), '1h');
  assert.equal(planDuration(3_780_000, false), '1h 3m');
});

test('elapsed comes from the wall-clock stamps, else Mochi’s minute clock', () => {
  assert.equal(stepElapsedMs(step({ startedAt: 5, startedMs: 1_000 }), 9, 43_000), 42_000, 'running: to now');
  assert.equal(stepElapsedMs(step({ startedAt: 5, doneAt: 6, startedMs: 1_000, doneMs: 6_000 }), 9, 43_000), 5_000, 'done: to done');
  assert.equal(stepElapsedMs(step({ startedAt: 5, startedMs: 50_000 }), 9, 43_000), 0, 'clock skew never goes negative');
  assert.equal(stepElapsedMs(step({ startedAt: 5 }), 7, 43_000), 120_000, 'demo step: minutes');
  assert.equal(stepElapsedMs(step({ status: 'done', startedAt: 5, doneAt: 6, startedMs: 1_000 }), 9, 43_000), 60_000, 'finished without a stamp: minutes, never still counting');
  assert.equal(stepElapsedMs(step({ status: 'ready' }), 7, 43_000), undefined);
  assert.deepEqual(planItems([step({ status: 'dropped', startedAt: 1 }), step({ status: 'ready' })], 7, 0), [{ title: 's', status: 'pending' }]);
});

test('an agent action stamps the steps it starts and finishes with its wall-clock ms, not older ones', () => {
  let s = base();
  const open = s.threads.find((t) => t.id === 'rl')!.steps.filter((x) => x.status !== 'dropped');
  const status = { rl5: 'done', rl6: 'running' } as Record<string, AgentPlanItem['status']>;
  const items = open.map((x): AgentPlanItem => ({ title: x.title, status: status[x.id] ?? 'pending' }));
  const byId = (st: State) => new Map(st.threads.find((t) => t.id === 'rl')!.steps.map((x) => [x.id, x]));
  s = threadsReducer(s, { type: 'agent', event: { threadId: 'rl', type: 'plan', items }, ms: 1_000 });
  let rl = byId(s);
  assert.equal(rl.get('rl5')!.doneMs, 1_000, 'finished now');
  assert.equal(rl.get('rl5')!.startedMs, undefined, 'started before the stamps existed');
  assert.equal(rl.get('rl6')!.startedMs, 1_000);

  s = threadsReducer(s, { type: 'agent', event: { threadId: 'rl', type: 'plan', items }, ms: 9_000 });
  rl = byId(s);
  assert.equal(rl.get('rl6')!.startedMs, 1_000, 'a repeat plan keeps the first stamp');
});

test('a plan is complete only when no step is pending or running', () => {
  assert.equal(isPlanComplete([]), true);
  assert.equal(isPlanComplete([{ title: 'a', status: 'done' }, { title: 'b', status: 'done' }]), true);
  assert.equal(isPlanComplete([{ title: 'a', status: 'done' }, { title: 'b', status: 'running' }]), false);
  assert.equal(isPlanComplete([{ title: 'a', status: 'done' }, { title: 'b', status: 'pending' }]), false);
});
