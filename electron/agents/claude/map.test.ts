import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { approvalEvent, claudeModels, commandsFrom, createMapper, permissionResult, planFromTodos, withPlanTools } from './map.ts';
import { FIXTURE } from './fixture.ts';

const CWD = '/repo';

test('maps a turn to session, message deltas, tools, plan, usage and turn end', () => {
  const { map } = createMapper('t1', CWD);
  const events = FIXTURE.flatMap((m) => map(m as SDKMessage));
  assert.deepEqual(
    events.map((e) => e.type),
    ['session', 'info', 'message', 'message', 'tool', 'plan', 'tool', 'tool', 'tool', 'tool', 'tool', 'message', 'usage', 'turn-end'],
  );
  const [, , first, second] = events;
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

test('init lists tools, MCP servers with their tool counts, skills, plugins and slash commands', () => {
  const { map } = createMapper('t1', CWD);
  const init = {
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1',
    parent_tool_use_id: null,
    cwd: '/repo',
    model: 'claude-opus-5-5',
    permissionMode: 'acceptEdits',
    claude_code_version: '2.3.0',
    tools: ['Bash', 'Read', 'mcp__github__create_pr', 'mcp__github__list_prs', 'mcp__my_docs__search'],
    mcp_servers: [
      { name: 'github', status: 'connected' },
      { name: 'my.docs', status: 'pending' },
      { name: 'odd', status: 'something-new' },
    ],
    skills: ['ui', 'run'],
    plugins: [{ name: 'ponytail', path: '/p', version: '4.7.0' }, { name: 'bare', path: '/b' }],
    slash_commands: ['compact', 'ui'],
  } as unknown as SDKMessage;
  assert.deepEqual(map(init), [
    { threadId: 't1', type: 'session', provider: 'claude', sessionId: 'sess-1' },
    {
      threadId: 't1',
      type: 'info',
      info: {
        model: 'claude-opus-5-5',
        cwd: '/repo',
        permissionMode: 'acceptEdits',
        version: '2.3.0',
        tools: ['Bash', 'Read'],
        mcpServers: [
          { name: 'github', status: 'connected', toolCount: 2 },
          { name: 'my.docs', status: 'pending', toolCount: 1 },
          { name: 'odd', status: 'failed', toolCount: 0 },
        ],
        skills: ['ui', 'run'],
        plugins: [{ name: 'ponytail', version: '4.7.0' }, { name: 'bare' }],
        slashCommands: ['compact', 'ui'],
      },
    },
  ]);
  const changed = { type: 'system', subtype: 'commands_changed', commands: [{ name: 'review', description: '', argumentHint: '' }] } as unknown as SDKMessage;
  assert.deepEqual(map(changed), [{ threadId: 't1', type: 'info', info: { slashCommands: ['review'], commands: [{ name: 'review', description: '' }] } }]);
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
  assert.deepEqual(approvalEvent('t1', 'r1', 'AskUserQuestion', input, '', ''), { threadId: 't1', type: 'question', requestId: 'r1', questions: [{ text: 'Which db?', options: ['Postgres', 'SQLite'], multiSelect: false }] });
  assert.deepEqual(permissionResult('AskUserQuestion', input, { kind: 'answer', answers: [['SQLite']] }), { behavior: 'allow', updatedInput: { ...input, answers: { 'Which db?': 'SQLite' } } });
});

test('AskUserQuestion: a multi-select answer with your own text goes back as one comma-joined string; a skipped question is left out', () => {
  const input = {
    questions: [
      { question: 'Which flows?', header: 'Flows', multiSelect: true, options: [{ label: 'Checkout', description: '' }, { label: 'Refund', description: '' }] },
      { question: 'Which db?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: '' }, { label: 'SQLite', description: '' }] },
    ],
  };
  assert.deepEqual(
    (approvalEvent('t1', 'r1', 'AskUserQuestion', input, '', '') as { questions: unknown }).questions,
    [{ text: 'Which flows?', options: ['Checkout', 'Refund'], multiSelect: true }, { text: 'Which db?', options: ['Postgres', 'SQLite'], multiSelect: false }],
  );
  assert.deepEqual(permissionResult('AskUserQuestion', input, { kind: 'answer', answers: [['Checkout', 'Refund', 'Gift cards too'], []] }), {
    behavior: 'allow',
    updatedInput: { ...input, answers: { 'Which flows?': 'Checkout, Refund, Gift cards too' } },
  });
});

test('approvals: Bash is a command, file tools are edits, deny carries a message', () => {
  assert.deepEqual(approvalEvent('t1', 'r', 'Bash', { command: 'rm -rf dist' }, 'Run rm', ''), { threadId: 't1', type: 'approval', requestId: 'r', kind: 'command', title: 'Run rm', detail: '', code: 'rm -rf dist' });
  assert.deepEqual(approvalEvent('t1', 'r', 'Write', { file_path: '/repo/a.ts' }, 'Write a.ts', 'why'), { threadId: 't1', type: 'approval', requestId: 'r', kind: 'edit', title: 'Write a.ts', detail: 'why', code: '/repo/a.ts' });
  assert.deepEqual(approvalEvent('t1', 'r', 'WebSearch', { query: 'EX271UZ review', allowed_domains: ['rtings.com', 'tftcentral.co.uk', 'a.com'] }, 'WebSearch', ''), { threadId: 't1', type: 'approval', requestId: 'r', kind: 'tool', title: 'Search the web for “EX271UZ review” on rtings.com, tftcentral.co.uk +1 more', detail: '' });
  assert.deepEqual(permissionResult('Bash', { command: 'ls' }, { kind: 'deny' }), { behavior: 'deny', message: 'The user declined this.' });
  assert.deepEqual(permissionResult('Bash', { command: 'ls' }, { kind: 'allow' }), { behavior: 'allow', updatedInput: { command: 'ls' } });
});

test('a rejected rate limit pauses the thread with its reset time; warnings pass', () => {
  const { map } = createMapper('t1', CWD);
  const event = (status: string, resetsAt?: number) => ({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt } }) as unknown as SDKMessage;
  assert.deepEqual(map(event('allowed_warning', 1_760_000_000)), []);
  assert.deepEqual(map(event('rejected', 1_760_000_000)), [{ threadId: 't1', type: 'limit', resetsAt: '2025-10-09T08:53:20.000Z' }]);
  assert.deepEqual(map(event('rejected')), [{ threadId: 't1', type: 'limit' }]);
});

test('sessions turn on the TaskCreate/TaskUpdate tools the plan is read from, keeping the rest of the env', () => {
  assert.deepEqual(withPlanTools({ PATH: '/bin' }), { PATH: '/bin', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' });
});

test('WebSearch ends with its hits as links, WebFetch with the page it read', () => {
  const { map } = createMapper('t1', CWD);
  const call = (id: string, name: string, input: Record<string, unknown>) => map({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } } as unknown as SDKMessage);
  const result = (id: string, toolUseResult: unknown) => map({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, tool_use_result: toolUseResult } as unknown as SDKMessage);

  assert.deepEqual(call('s1', 'WebSearch', { query: 'token bucket' }), [{ threadId: 't1', type: 'tool', id: 's1', phase: 'start', text: 'Search token bucket' }]);
  const hits = { query: 'token bucket', durationSeconds: 1, results: ['Here is what I found', { tool_use_id: 'x', content: [{ title: 'Token bucket', url: 'https://en.wikipedia.org/wiki/Token_bucket' }, { title: '', url: 'https://redis.io/' }] }] };
  assert.deepEqual(result('s1', hits).at(0), { threadId: 't1', type: 'tool', id: 's1', phase: 'end', text: 'Search token bucket', links: [{ url: 'https://en.wikipedia.org/wiki/Token_bucket', title: 'Token bucket' }, { url: 'https://redis.io/' }] });

  call('f1', 'WebFetch', { url: 'http://redis.io/docs', prompt: 'summarize' });
  const fetched = { url: 'https://redis.io/docs/', code: 200, codeText: 'OK', bytes: 1, result: '', durationMs: 1 };
  assert.deepEqual(result('f1', fetched).at(0), { threadId: 't1', type: 'tool', id: 'f1', phase: 'end', text: 'Fetch http://redis.io/docs', links: [{ url: 'https://redis.io/docs/' }] });
});

test('supportedModels() lists each model once by its wire id, the default row marking the default', () => {
  const effort = { supportsEffort: true, supportedEffortLevels: ['low', 'high'] as ('low' | 'high')[] };
  const models = claudeModels([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5', ...effort },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Best for everyday, complex tasks', ...effort },
    { value: 'claude-opus-5-5', displayName: 'Opus 5.5 (explicit)', description: '' },
    { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest' },
  ]);
  assert.deepEqual(models, [
    { id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'Best for everyday, complex tasks', efforts: ['low', 'high'], isDefault: true },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fastest', efforts: [], isDefault: false },
  ]);
});

test('a background Agent call becomes a subagent with its own steps, tokens and result, out of the parent log (real 2.1.296 trace)', () => {
  const trace = readFileSync(new URL('./fixtures/subagent.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as SDKMessage);
  const mapper = createMapper('t1', '/tmp/scratch');
  const events = trace.flatMap(mapper.map);
  const id = 'toolu_016eg9L6pu9B97dXqe5vUWok';
  const subagent = events.filter((e) => e.type === 'subagent');
  assert.ok(subagent.every((e) => e.id === id && e.threadId === 't1'));
  assert.deepEqual(subagent[0], { threadId: 't1', type: 'subagent', id, phase: 'start', toolId: id, name: 'Echo hi', prompt: 'Run `echo hi` with Bash and reply with its output only.', isBackground: true });
  assert.deepEqual(subagent.flatMap((e) => (e.step ? [[e.step.phase, e.step.text, e.step.exitCode]] : [])), [['start', 'Run echo hi', undefined], ['end', 'Run echo hi', 0]]);
  assert.ok(subagent.some((e) => e.phase === 'progress' && e.model === 'claude-haiku-5-5'), 'the launch receipt names the model');
  assert.ok(subagent.some((e) => e.activity === 'Running Print hi via echo' && e.tokens === 22021));
  assert.deepEqual(subagent.filter((e) => e.phase === 'end'), [{ threadId: 't1', type: 'subagent', id, phase: 'end', status: 'done', result: 'hi', tokens: 24873 }]);
  assert.equal(mapper.taskOf(id), 'a169bf8f299bdb8d4', 'stopTask gets the task id Claude Code registered');
  assert.deepEqual(events.filter((e) => e.type === 'tool'), [], "neither the Agent call nor the subagent's Bash land in the parent's work log");
  assert.deepEqual(events.filter((e) => e.type === 'turn-end').length, 2, 'the background report starts a turn of its own');
});

test('a foreground Agent call ends with its answer from the tool result; a failed one with the error', () => {
  const { map } = createMapper('t1', CWD);
  const base = { parent_tool_use_id: null, session_id: 's', uuid: 'u' };
  map({ ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Find usages', prompt: 'grep', run_in_background: false } }] } } as unknown as SDKMessage);
  const done = map({ ...base, type: 'user', tool_use_result: { status: 'completed', agentId: 'x', content: [{ type: 'text', text: 'Found 3' }], totalTokens: 900, totalToolUseCount: 2, totalDurationMs: 10, usage: {}, prompt: 'grep', resolvedModel: 'claude-haiku-5-5' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'Found 3' }] } } as unknown as SDKMessage);
  assert.deepEqual(done, [{ threadId: 't1', type: 'subagent', id: 'a1', phase: 'end', status: 'done', result: 'Found 3', tokens: 900, model: 'claude-haiku-5-5' }]);
  map({ ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a2', name: 'Task', input: { description: 'Broken' } }] } } as unknown as SDKMessage);
  const failed = map({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a2', content: 'Agent type not found', is_error: true }] } } as unknown as SDKMessage);
  assert.deepEqual(failed, [{ threadId: 't1', type: 'subagent', id: 'a2', phase: 'end', status: 'failed', error: 'Agent type not found' }]);
  assert.deepEqual(map({ ...base, parent_tool_use_id: 'unknown', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } } as unknown as SDKMessage), [], 'traffic from an agent we never saw start is dropped');
});

test('commands keep skills and custom commands with their argument hints, not Claude Code built-ins', () => {
  assert.deepEqual(
    commandsFrom([
      { name: 'compact', description: 'Compact the conversation', argumentHint: '', builtin: true },
      { name: 'fix-lint', description: 'Fix lint', argumentHint: '<file> [--fix]' },
      { name: 'review', description: 'Review', argumentHint: '' },
    ]),
    [
      { name: 'fix-lint', description: 'Fix lint', argumentHint: '<file> [--fix]' },
      { name: 'review', description: 'Review' },
    ],
  );
});

test('a Skill call is a skill load and an mcp__ call names its server and tool, read back through init', () => {
  const { map } = createMapper('t1', CWD);
  map({ type: 'system', subtype: 'init', session_id: 's', parent_tool_use_id: null, cwd: CWD, tools: [], mcp_servers: [{ name: 'claude.ai Linear', status: 'connected' }, { name: 'git', status: 'connected' }, { name: 'github', status: 'connected' }] } as unknown as SDKMessage);
  const call = (id: string, name: string, input: Record<string, unknown>) => map({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } } as unknown as SDKMessage);
  const result = (id: string) => map({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Launching skill: ui' }] }, tool_use_result: { success: true, commandName: 'ui' } } as unknown as SDKMessage);

  assert.deepEqual(call('k1', 'Skill', { skill: '/ui', args: 'the header' }), [{ threadId: 't1', type: 'tool', id: 'k1', phase: 'start', text: 'Skill ui', skill: 'ui' }]);
  assert.deepEqual(result('k1'), [{ threadId: 't1', type: 'tool', id: 'k1', phase: 'end', text: 'Skill ui' }]);
  assert.deepEqual(call('m1', 'mcp__claude_ai_Linear__get_issue', { id: 'LAT-1' })[0], { threadId: 't1', type: 'tool', id: 'm1', phase: 'start', text: 'Mcp claude.ai Linear: get_issue', mcp: { server: 'claude.ai Linear', tool: 'get_issue' } });
  const github = call('m2', 'mcp__github__list_prs', {})[0];
  assert.deepEqual(github.type === 'tool' && github.mcp, { server: 'github', tool: 'list_prs' }, 'the longer server name wins over a prefix of it');
  const unknown = call('m3', 'mcp__later__do_it', {})[0];
  assert.deepEqual(unknown.type === 'tool' && unknown.mcp, { server: 'later', tool: 'do_it' }, 'a server init did not list splits at its first __');
  assert.deepEqual(call('b1', 'Skill', {})[0], { threadId: 't1', type: 'tool', id: 'b1', phase: 'start', text: 'Skill' }, 'no skill name, no skill load');
});

test('a message opening with a /skill reports the load itself, once init has listed the skills (2.1.296 emits nothing for it)', () => {
  const mapper = createMapper('t1', CWD);
  assert.deepEqual(mapper.sent('/shout what is 2+2?'), [], 'init not in yet: held');
  const init = mapper.map({ type: 'system', subtype: 'init', session_id: 's', parent_tool_use_id: null, cwd: CWD, tools: [], mcp_servers: [], skills: ['shout'] } as unknown as SDKMessage);
  assert.deepEqual(
    init.filter((e) => e.type === 'tool').map((e) => e.type === 'tool' && [e.phase, e.text, e.skill]),
    [
      ['start', 'Skill shout', 'shout'],
      ['end', 'Skill shout', 'shout'],
    ],
  );
  assert.equal(mapper.sent('/shout again').length, 2, 'known now: reported at once');
  assert.deepEqual(mapper.sent('/compact'), [], 'a command that is not a skill');
  assert.deepEqual(mapper.sent('no command'), []);
});
