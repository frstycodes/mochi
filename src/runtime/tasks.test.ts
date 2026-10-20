import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent } from '../host/types/agent.ts';
import type { Action, State } from '../store/index.tsx';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls, type AgentCall } from './live.ts';
import { runningTasks, shortElapsed, taskResult, threadTasks } from './tasks.ts';

/** A live Claude thread plus every host.agent call the store would make. */
function setup() {
  let state = { ...initialThreads(undefined, false), panes: [], spaceId: 'latitude', views: {} } as unknown as State;
  const calls: AgentCall[] = [];
  const dispatch = (a: Action) => {
    const before = state;
    calls.push(...agentCalls(before, a, () => threadsReducer(before, a)));
    state = threadsReducer(before, a);
  };
  dispatch({ type: 'create', title: 'Run the suite', provider: 'claude', project: '/repo', isLive: true });
  const id = state.threads[0].id;
  const event = (e: Omit<Extract<AgentEvent, { type: 'task' }>, 'threadId' | 'type'>) => dispatch({ type: 'agent', event: { threadId: id, type: 'task', ...e } });
  calls.length = 0;
  return { id, dispatch, event, calls, thread: () => state.threads[0] };
}

test('a background command runs, picks up its log, and stops only when its harness says so', () => {
  const { id, dispatch, event, calls, thread } = setup();
  event({ id: 'b1', phase: 'start', kind: 'shell', title: 'Wait a minute', command: 'sleep 60' });
  event({ id: 'b1', phase: 'progress', outputFile: '/tmp/tasks/b1.output' });
  assert.equal(runningTasks(thread()), 1);
  assert.deepEqual(threadTasks(thread()).map((t) => [t.kind, t.title, t.status, t.outputFile]), [['shell', 'Wait a minute', 'running', '/tmp/tasks/b1.output']]);

  dispatch({ type: 'task-stop', threadId: id, taskId: 'b1' });
  assert.deepEqual(calls, [{ method: 'stopTask', threadId: id, taskId: 'b1' }]);
  assert.equal(thread().backgroundTasks![0].status, 'running', 'a live harness reports the stop itself');

  event({ id: 'b1', phase: 'end', status: 'stopped' });
  event({ id: 'b1', phase: 'end', status: 'done' });
  assert.equal(thread().backgroundTasks![0].status, 'stopped', 'the first end wins');
  assert.equal(runningTasks(thread()), 0);

  calls.length = 0;
  dispatch({ type: 'task-stop', threadId: id, taskId: 'b1' });
  assert.deepEqual(calls, [], 'nothing to stop once it ended');
});

test('failed commands keep their exit code; background agents join the list in start order, foreground ones never do', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { id, dispatch, event, thread } = setup();
  dispatch({ type: 'agent', event: { threadId: id, type: 'subagent', id: 'a1', phase: 'start', name: 'Review the diff', isBackground: true } });
  dispatch({ type: 'agent', event: { threadId: id, type: 'subagent', id: 'a2', phase: 'start', name: 'Find usages', isBackground: false } });
  t.mock.timers.tick(1000);
  event({ id: 'b2', phase: 'start', kind: 'shell', title: 'exit 3' });
  event({ id: 'b2', phase: 'end', status: 'failed', exitCode: 3 });
  const rows = threadTasks(thread());
  assert.deepEqual(
    rows.map((t) => [t.id, t.kind, t.status]),
    [
      ['a1', 'agent', 'running'],
      ['b2', 'shell', 'failed'],
    ],
  );
  assert.equal(taskResult(rows[1]), 'Exit 3');
  assert.equal(taskResult({ status: 'failed' }), 'Failed');
  assert.equal(taskResult({ status: 'done', exitCode: 0 }), 'Done');
});

test('elapsed reads as a short age', () => {
  assert.deepEqual([45_000, 8 * 60_000 + 59_000, 2 * 3_600_000 + 5 * 60_000].map(shortElapsed), ['45s', '8m', '2h']);
});
