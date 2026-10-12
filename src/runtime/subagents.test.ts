import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent } from '../host/types/agent.ts';
import type { Action, State } from '../store/index.tsx';
import { panesReducer } from '../store/panes.ts';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls, type AgentCall } from './live.ts';
import { oneLine } from './subagents.ts';
import { DEFAULT_PREFS } from '../settings/prefs.ts';
import { runTool, type ToolEnv } from './tools.ts';

const reduce = (s: State, a: Action) => [threadsReducer, queueReducer, panesReducer].reduce((x, r) => r(x, a), s);

/** A live Claude thread in a project, its agent running in its worktree, plus every host.agent call the store would make. */
function setup() {
  let state = {
    ...initialThreads(undefined, false),
    ...initialQueue(undefined, false),
    panes: [],
    spaceId: 'latitude',
    views: {},
  } as unknown as State;
  const calls: AgentCall[] = [];
  const dispatch = (a: Action) => {
    const before = state;
    calls.push(...agentCalls(before, a, () => reduce(before, a)));
    state = reduce(before, a);
  };
  dispatch({
    type: 'create',
    title: 'Rate limit the API',
    provider: 'claude',
    project: '/repo',
    isLive: true,
  });
  const id = state.threads[0].id;
  dispatch({
    type: 'agent',
    event: { threadId: id, type: 'worktree', path: '/wt/main' },
  });
  dispatch({
    type: 'agent',
    event: {
      threadId: id,
      type: 'session',
      provider: 'claude',
      sessionId: 'sess',
    },
  });
  calls.length = 0;
  const env = {
    getState: () => state,
    dispatch,
    // The middle level: start and stop are `change` tools and must run without a card.
    prefs: { get: () => ({ ...DEFAULT_PREFS, agentControl: 'changes' }), set: () => {} },
    toast: () => {},
    notify: () => {},
    isDesktop: true,
  } as unknown as ToolEnv;
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await runTool({ id: 'c', threadId: id, name, args }, env);
    return { ...result, json: result.isError ? null : JSON.parse(result.text) };
  };
  const event = (e: AgentEvent) => dispatch({ type: 'agent', event: e });
  const thread = () => state.threads.find((t) => t.id === id)!;
  return { id, tool, event, dispatch, thread, calls, state: () => state };
}

test('start_background_agent runs a session of its own, reports back into the thread, and its report reaches the agent with the next message', async () => {
  const { id, tool, event, dispatch, thread, calls, state } = setup();
  const started = await tool('start_background_agent', {
    prompt: 'Load test the limiter',
    name: 'Load test',
  });
  assert.equal(started.isError, undefined, started.text);
  assert.deepEqual([started.json.id, started.json.status, started.json.origin], ['bg1', 'running', 'mochi']);

  const session = `${id}--bg1`;
  assert.equal(calls.length, 1);
  const [start] = calls;
  assert.equal(start.method === 'start' && start.threadId, session, 'its own session in host.agent, so the concurrency cap counts it');
  assert.equal(start.method === 'start' && start.options.cwd, '/wt/main', "worktree: same runs in the thread's worktree");
  assert.equal(start.method === 'start' && start.options.workspace, undefined);
  assert.match(start.method === 'start' ? start.options.prompt : '', /^Load test the limiter\n\nYou are a background agent/);

  const pane = state().panes.find((p) => p.threadId === id)!;
  assert.deepEqual(
    pane.tabs.map((t) => t.kind),
    ['agents'],
    'the first background agent opens the Agents tab',
  );

  event({
    threadId: session,
    type: 'tool',
    id: 'k1',
    phase: 'start',
    text: 'Run k6 run load.js',
  });
  event({
    threadId: session,
    type: 'tool',
    id: 'k1',
    phase: 'end',
    text: 'Run k6 run load.js',
    exitCode: 0,
  });
  event({
    threadId: session,
    type: 'usage',
    inputTokens: 900,
    outputTokens: 100,
    costUsd: 0.01,
    contextUsed: 50_000,
    contextMax: 200_000,
  });
  event({
    threadId: session,
    type: 'message',
    text: 'p95 is 11ms',
    isDelta: false,
  });
  event({
    threadId: session,
    type: 'message',
    text: ' at 1,200 rps.',
    isDelta: true,
  });
  const running = thread().subagents![0];
  assert.deepEqual(running.steps, [{ id: 'k1', text: 'Run k6 run load.js', isDone: true, exitCode: 0 }]);
  assert.equal(running.tokens, 1000);
  assert.equal(thread().session?.usage?.input, 900, "its spend is the thread's");
  assert.notEqual(thread().context.used, 50_000, "its context isn't");
  assert.deepEqual(
    thread().activity.filter((a) => a.kind === 'tool'),
    [],
    "its tools stay out of the thread's work log",
  );

  calls.length = 0;
  event({ threadId: session, type: 'turn-end', status: 'done' });
  assert.deepEqual(calls, [{ method: 'stop', threadId: session }], 'its session ends with its first turn');
  const done = thread().subagents![0];
  assert.deepEqual([done.status, done.result], ['done', 'p95 is 11ms at 1,200 rps.']);
  assert.equal(thread().activity.at(-1)?.text, 'Background agent "Load test" finished');
  event({
    threadId: session,
    type: 'turn-end',
    status: 'failed',
    error: 'late',
  });
  assert.equal(thread().subagents![0].status, 'done', 'the first end wins');

  calls.length = 0;
  dispatch({ type: 'send', threadId: id, text: 'thanks', reason: '' });
  assert.deepEqual(calls, [
    {
      method: 'send',
      threadId: id,
      text: '[Background agent "Load test" finished]\np95 is 11ms at 1,200 rps.\n\nthanks',
    },
  ]);
  assert.equal(thread().live?.notes, undefined, 'delivered once');

  const listed = await tool('list_background_agents');
  assert.deepEqual(
    listed.json.agents.map((a: { id: string; status: string; result: string }) => [a.id, a.status, a.result]),
    [['bg1', 'done', 'p95 is 11ms at 1,200 rps.']],
  );
});

test("a background agent in a worktree of its own branches off the thread's branch; stop ends it and its session", async () => {
  const { id, tool, event, thread, calls } = setup();
  const branch = thread().repo!.branch;
  await tool('start_background_agent', {
    prompt: 'Try the Redis approach',
    name: 'Redis spike',
    worktree: 'new',
    provider: 'codex',
  });
  const [start] = calls;
  assert.deepEqual(start.method === 'start' && [start.options.provider, start.options.cwd, start.options.workspace], ['codex', '/repo', { mode: 'worktree', branch: `${branch}-bg1`, base: branch }]);
  event({ threadId: `${id}--bg1`, type: 'worktree', path: '/wt/redis' });
  assert.equal(thread().subagents![0].cwd, '/wt/redis');

  calls.length = 0;
  const stopped = await tool('stop_background_agent', { id: 'bg1' });
  assert.equal(stopped.json.status, 'stopped');
  assert.deepEqual(calls, [{ method: 'stop', threadId: `${id}--bg1` }]);
  assert.match((await tool('stop_background_agent', { id: 'bg1' })).text, /already stopped/);
  assert.match((await tool('stop_background_agent', { id: 'nope' })).text, /No agent nope/);
});

test("a background agent's approval waits on the thread's queue, and settling the thread stops it", async () => {
  const { id, tool, event, dispatch, state, calls } = setup();
  await tool('start_background_agent', { prompt: 'x', name: 'Migrator' });
  event({
    threadId: `${id}--bg1`,
    type: 'approval',
    requestId: 'r1',
    kind: 'command',
    title: 'Run a command',
    detail: '',
    code: 'rm -rf dist',
  });
  const card = state().queue.find((q) => q.requestId === 'r1')!;
  assert.deepEqual([card.threadId, card.title], [id, 'Migrator: Run a command']);
  calls.length = 0;
  dispatch({ type: 'settle', threadId: id });
  assert.ok(calls.some((c) => c.method === 'stop' && c.threadId === `${id}--bg1`));
});

test('native subagents: start logs one row where it began, progress fills its log, the first end wins, and stop goes to the harness', () => {
  const { id, event, dispatch, thread, calls, state } = setup();
  event({
    threadId: id,
    type: 'subagent',
    id: 'toolu_1',
    phase: 'start',
    toolId: 'toolu_1',
    name: 'Find callers',
    isBackground: false,
  });
  assert.deepEqual(thread().activity.at(-1), {
    at: state().now,
    who: 'claude',
    kind: 'subagent',
    text: 'Find callers',
    subagentId: 'toolu_1',
  });
  assert.equal(state().panes.length, 0, 'a foreground subagent leaves the pane alone');
  event({
    threadId: id,
    type: 'subagent',
    id: 'toolu_1',
    phase: 'progress',
    isBackground: true,
  });
  assert.deepEqual(
    state().panes[0].tabs.map((t) => t.kind),
    ['agents'],
    'moved to the background, it opens the Agents tab',
  );
  event({
    threadId: id,
    type: 'subagent',
    id: 'toolu_1',
    phase: 'progress',
    step: { id: 's1', phase: 'start', text: 'Edit src/a.ts' },
  });
  event({
    threadId: id,
    type: 'subagent',
    id: 'toolu_1',
    phase: 'progress',
    step: {
      id: 's1',
      phase: 'end',
      text: 'Edit src/a.ts',
      files: ['src/a.ts'],
    },
    tokens: 4200,
  });

  calls.length = 0;
  dispatch({ type: 'bg-stop', threadId: id, subagentId: 'toolu_1' });
  assert.deepEqual(calls, [{ method: 'stopSubagent', threadId: id, subagentId: 'toolu_1' }]);
  assert.equal(thread().subagents![0].status, 'running', 'a native agent ends when its harness says so');

  event({
    threadId: id,
    type: 'subagent',
    id: 'toolu_1',
    phase: 'end',
    status: 'stopped',
  });
  event({
    threadId: id,
    type: 'subagent',
    id: 'toolu_1',
    phase: 'end',
    status: 'done',
    result: 'late',
  });
  const s = thread().subagents![0];
  assert.deepEqual([s.status, s.tokens, s.result, s.steps[0].files], ['stopped', 4200, undefined, ['src/a.ts']]);
  assert.equal(thread().live?.notes, undefined, "a native agent reports to its own harness, not through Mochi's notes");
});

test("a report's one line drops markdown marks and link targets", () => {
  assert.equal(oneLine('\n**Verified** the `EX271UZ`. [BenQ page](https://benq.com/x)\nmore'), 'Verified the EX271UZ. BenQ page');
  assert.equal(oneLine('## Summary'), 'Summary');
  assert.equal(oneLine('- first item'), 'first item');
  assert.equal(oneLine(undefined), '');
});
