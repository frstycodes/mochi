import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { approvalEvent, createMapper, permissionResult, planFromTodos } from './map.ts';
import { FIXTURE } from './fixture.ts';

const CWD = '/repo';

test('maps a turn to session, message deltas, tools, plan, usage and turn end', () => {
  const { map } = createMapper('t1', CWD);
  const events = FIXTURE.flatMap((m) => map(m as SDKMessage));
  assert.deepEqual(
    events.map((e) => e.type),
    ['session', 'message', 'message', 'tool', 'plan', 'tool', 'tool', 'tool', 'tool', 'tool', 'message', 'usage', 'turn-end'],
  );
  const [, first, second] = events;
  assert.deepEqual([first, second], [
    { threadId: 't1', type: 'message', text: 'Adding', isDelta: false },
    { threadId: 't1', type: 'message', text: ' a test.', isDelta: true },
  ]);
  const edit = events.find((e) => e.type === 'tool' && e.phase === 'end' && e.files);
  assert.deepEqual(edit && edit.type === 'tool' && edit.files, ['src/a.ts']);
  const bash = events.find((e) => e.type === 'tool' && e.phase === 'end' && e.exitCode !== undefined);
  assert.equal(bash?.type === 'tool' && bash.exitCode, 2);
  const usage = events.find((e) => e.type === 'usage');
  assert.deepEqual(usage, { threadId: 't1', type: 'usage', inputTokens: 1300, outputTokens: 40, costUsd: 0.02, contextUsed: 1250, contextMax: 200_000 });
  assert.deepEqual(events.at(-1), { threadId: 't1', type: 'turn-end', status: 'done' });
});

test('usage after a second result is the difference from the first, since results carry running totals', () => {
  const { map } = createMapper('t1', CWD);
  const result = (input: number, cost: number) =>
    ({ type: 'result', subtype: 'success', parent_tool_use_id: null, total_cost_usd: cost, modelUsage: { m: { inputTokens: input, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 1000 } } }) as unknown as SDKMessage;
  map(result(100, 0.5));
  const [usage] = map(result(250, 0.75));
  assert.deepEqual(usage, { threadId: 't1', type: 'usage', inputTokens: 150, outputTokens: 0, costUsd: 0.25 });
});

test('a result after interrupt ends the turn as interrupted, not failed', () => {
  const mapper = createMapper('t1', CWD);
  mapper.markInterrupting();
  const events = mapper.map({ type: 'result', subtype: 'error_during_execution', errors: [], total_cost_usd: 0, modelUsage: {} } as unknown as SDKMessage);
  assert.deepEqual(events.at(-1), { threadId: 't1', type: 'turn-end', status: 'interrupted' });
});

test('TaskCreate and TaskUpdate build the plan once the created task has an id', () => {
  const { map } = createMapper('t1', CWD);
  const use = (id: string, name: string, input: object) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } }) as unknown as SDKMessage;
  const done = (id: string, result: unknown) => ({ type: 'user', parent_tool_use_id: null, tool_use_result: result, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }) as unknown as SDKMessage;
  map(use('a', 'TaskCreate', { subject: 'Write the parser', description: '' }));
  assert.deepEqual(map(done('a', { task: { id: '1', subject: 'Write the parser' } })).at(-1), { threadId: 't1', type: 'plan', items: [{ title: 'Write the parser', status: 'pending' }] });
  assert.deepEqual(map(use('b', 'TaskUpdate', { taskId: '1', status: 'in_progress' })).at(-1), { threadId: 't1', type: 'plan', items: [{ title: 'Write the parser', status: 'running' }] });
  assert.deepEqual(map(use('c', 'TaskUpdate', { taskId: '1', status: 'deleted' })).at(-1), { threadId: 't1', type: 'plan', items: [] });
});

test('plan from TodoWrite maps statuses and skips malformed items', () => {
  assert.deepEqual(
    planFromTodos({
      todos: [
        { content: 'Read the code', status: 'completed', activeForm: 'Reading' },
        { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing' },
        { content: 'Add a test', status: 'pending', activeForm: 'Adding' },
        { status: 'pending' },
      ],
    }),
    [
      { title: 'Read the code', status: 'done' },
      { title: 'Fix the bug', status: 'running' },
      { title: 'Add a test', status: 'pending' },
    ],
  );
  assert.deepEqual(planFromTodos({}), []);
});

test('subagent messages are skipped', () => {
  const { map } = createMapper('t1', CWD);
  assert.deepEqual(map({ type: 'assistant', parent_tool_use_id: 'task-1', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }] } } as unknown as SDKMessage), []);
});

test('AskUserQuestion becomes a question and its answers go back keyed by question text', () => {
  const input = { questions: [{ question: 'Which db?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }] }] };
  assert.deepEqual(approvalEvent('t1', 'r1', 'AskUserQuestion', input, '', ''), { threadId: 't1', type: 'question', requestId: 'r1', questions: [{ text: 'Which db?', options: ['Postgres', 'SQLite'] }] });
  assert.deepEqual(permissionResult('AskUserQuestion', input, { kind: 'answer', answers: ['SQLite'] }), { behavior: 'allow', updatedInput: { ...input, answers: { 'Which db?': 'SQLite' } } });
});

test('approvals: Bash is a command, file tools are edits, deny carries a message', () => {
  assert.deepEqual(approvalEvent('t1', 'r', 'Bash', { command: 'rm -rf dist' }, 'Run rm', ''), { threadId: 't1', type: 'approval', requestId: 'r', kind: 'command', title: 'Run rm', detail: '', code: 'rm -rf dist' });
  assert.deepEqual(approvalEvent('t1', 'r', 'Write', { file_path: '/repo/a.ts' }, 'Write a.ts', 'why'), { threadId: 't1', type: 'approval', requestId: 'r', kind: 'edit', title: 'Write a.ts', detail: 'why', code: '/repo/a.ts' });
  assert.deepEqual(permissionResult('Bash', { command: 'ls' }, { kind: 'deny' }), { behavior: 'deny', message: 'The user declined this.' });
  assert.deepEqual(permissionResult('Bash', { command: 'ls' }, { kind: 'allow' }), { behavior: 'allow', updatedInput: { command: 'ls' } });
});
