import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScheduleRun } from '../host/types/schedule.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls } from '../runtime/live.ts';
import { scheduleReducer } from './slice.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const reduce = (s: State, action: Action) => [threadsReducer, queueReducer, scheduleReducer].reduce((acc, slice) => slice(acc, action), s);

test('a scheduled thread waits for its run; the run wakes it, lands in the Queue, and Settle clears it', () => {
  const create: Action = { type: 'create', title: 'Nightly dependency check', provider: 'claude', project: '/Users/me/dev/harness', isLive: true, isBackground: true, schedule: { when: { kind: 'cron', cron: '0 2 * * *' }, missed: 'run-once' } };
  let s = base();
  assert.deepEqual(agentCalls(s, create, () => reduce(s, create)), [], 'no agent starts until the first run');
  s = reduce(s, create);
  const thread = s.threads.at(-1)!;
  assert.deepEqual([thread.live?.isWorking, thread.live?.isDetached], [false, true]);
  assert.equal(thread.activity.at(-1)?.text, 'Scheduled: Every day at 02:00');

  const run: ScheduleRun = { id: 'run-1', threadId: thread.id, reason: 'Every day at 02:00', startedAt: 0, status: 'running' };
  s = reduce(s, { type: 'schedule-run', event: { type: 'run-start', run, name: 'Nightly dependency check', prompt: 'Check deps' } });
  assert.equal(s.threads.at(-1)!.live?.isWorking, true);
  s = reduce(s, { type: 'schedule-run', event: { type: 'run-end', run: { ...run, status: 'done', summary: '2 findings', endedAt: 30_000 }, name: 'Nightly dependency check' } });
  const item = s.queue.find((q) => q.kind === 'run')!;
  assert.equal(item.title, 'Nightly dependency check finished: 2 findings');
  assert.equal(item.detail, 'Every day at 02:00 · ran under a minute');

  s = reduce(s, { type: 'answer', queueId: item.id });
  assert.ok(!s.queue.some((q) => q.kind === 'run'));
  assert.equal(s.threads.at(-1)!.activity.at(-1)?.text, 'Settled: Nightly dependency check finished: 2 findings');
});
