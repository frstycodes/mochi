import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { AgentEvent } from '../../../src/host/types/agent.ts';
import { CodexAdapter, reply } from './adapter.ts';
import { codexThreadId, infoFromLists, infoFromStart, mapNotification, mapRequest, requestKey, threadState, updateLimits } from './map.ts';
import { parseMessage, RpcClient, type RpcId } from './rpc.ts';

// Fixtures are real `codex app-server` 0.155.1 output (gpt-6-luna, approval policy `untrusted`), noisy methods filtered out.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8');

/** Replays a recording through the RPC client in odd-sized chunks, then maps it the way the adapter does. */
function replay(name: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const s = threadState('h1', '/tmp/scratch');
  const events: AgentEvent[] = [];
  const unhandled: string[] = [];
  const rpc = new RpcClient(input, output, {
    onNotification: (method, params) => events.push(...mapNotification(method, params, s)),
    onRequest: (id, method, params) => {
      const event = mapRequest(method, params, requestKey('default', id), s);
      if (event) events.push(event);
      else unhandled.push(method);
    },
    onInvalid: () => {},
  });
  const text = fixture(name);
  for (let i = 0; i < text.length; i += 37) input.write(text.slice(i, i + 37));
  rpc.close('done');
  return { events, unhandled, s };
}

test('a real turn maps to streamed messages, a plan, a command, an approval and usage', () => {
  const { events, unhandled } = replay('plan');
  assert.deepEqual(unhandled, []);

  const messages = events.filter((e) => e.type === 'message');
  assert.equal(messages[0].isDelta, false, 'the first delta of an item opens a new entry');
  assert.ok(messages.slice(1, -1).every((m) => m.isDelta));
  assert.equal(messages.map((m) => m.text).join(''), 'I’ll record the two-step plan, run the requested `touch` command, then mark both steps complete.done');
  assert.equal(messages.at(-1)!.isDelta, false, 'the second agent message opens its own entry');

  const plans = events.filter((e) => e.type === 'plan');
  assert.deepEqual(plans.map((p) => p.items), [
    [{ title: 'Create b.txt', status: 'running' }, { title: 'Confirm', status: 'pending' }],
    [{ title: 'Create b.txt', status: 'done' }, { title: 'Confirm', status: 'done' }],
  ]);

  const tools = events.filter((e) => e.type === 'tool');
  assert.deepEqual(tools.map((t) => [t.phase, t.text, t.exitCode]), [['start', "/bin/zsh -lc 'touch c.txt'", undefined], ['end', "/bin/zsh -lc 'touch c.txt'", 0]]);

  const approval = events.find((e) => e.type === 'approval')!;
  assert.deepEqual(approval, { threadId: 'h1', type: 'approval', requestId: 'codex:default:number:0', kind: 'command', title: 'Run a command', detail: 'In /tmp/scratch', code: "/bin/zsh -lc 'touch c.txt'" });
  assert.deepEqual(events.find((e) => e.type === 'resolved'), { threadId: 'h1', type: 'resolved', requestId: 'codex:default:number:0' });

  const usage = events.filter((e) => e.type === 'usage');
  assert.deepEqual(usage.map((u) => [u.inputTokens, u.outputTokens]), [[21292, 164], [42776 - 21292, 209 - 164], [64329 - 42776, 214 - 209]], 'usage carries per-update differences, since the store sums them');
  assert.deepEqual([usage[0].contextUsed, usage[0].contextMax], [21456, 258400]);
  assert.ok(usage.every((u) => u.costUsd! >= 0));

  assert.deepEqual(events.at(-1), { threadId: 'h1', type: 'turn-end', status: 'done' });
});

test('a message that never streamed arrives whole from item/completed, once', () => {
  const s = threadState('h1', '/x');
  const item = { type: 'agentMessage', id: 'm1', text: 'hello' };
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item }, s), [{ threadId: 'h1', type: 'message', text: 'hello', isDelta: false }]);
  mapNotification('item/agentMessage/delta', { threadId: 't', itemId: 'm2', delta: 'hi' }, s);
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: { ...item, id: 'm2' } }, s), []);
});

test('a failed turn carries the API message, not its raw JSON body', () => {
  const end = replay('failed').events.at(-1)!;
  assert.equal(end.type, 'turn-end');
  assert.equal(end.type === 'turn-end' && end.status, 'failed');
  assert.match(end.type === 'turn-end' ? end.error! : '', /^The 'gpt-6\.1-sol' model is not supported/);
});

test('file changes report paths relative to the worktree and name them on the approval', () => {
  const s = threadState('h1', '/repo');
  const item = { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: '/repo/src/a.ts', kind: { type: 'update' }, diff: '' }, { path: 'b.ts', kind: { type: 'add' }, diff: '' }] };
  assert.deepEqual(mapNotification('item/started', { threadId: 't', item }, s), [{ threadId: 'h1', type: 'tool', id: 'f1', phase: 'start', text: 'Edit src/a.ts, b.ts' }]);
  const approval = mapRequest('item/fileChange/requestApproval', { threadId: 't', turnId: 'u', itemId: 'f1' }, 'codex:string:9', s);
  assert.equal(approval?.type === 'approval' && approval.title, 'Edit src/a.ts, b.ts');
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: { ...item, status: 'completed' } }, s).at(0), { threadId: 'h1', type: 'tool', id: 'f1', phase: 'end', text: 'Edit src/a.ts, b.ts', files: ['src/a.ts', 'b.ts'] });
});

test('after a resume only the reported request counts, not the whole history', () => {
  const s = threadState('h1', '/x', { isResumed: true });
  const tokenUsage = { total: { inputTokens: 90_000, cachedInputTokens: 0, outputTokens: 900, totalTokens: 90_900 }, last: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 10, totalTokens: 1010 }, modelContextWindow: null };
  const [u] = mapNotification('thread/tokenUsage/updated', { threadId: 't', tokenUsage }, s);
  assert.deepEqual(u.type === 'usage' && [u.inputTokens, u.outputTokens, u.contextMax], [1000, 10, undefined]);
});

test('a usage limit pauses the thread with the account-wide reset time, then ends the turn', () => {
  const limits = {};
  updateLimits(limits, { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1791808455 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1792000000 } } });
  updateLimits(limits, { rateLimits: { primary: null, secondary: null } });
  const s = threadState('h1', '/x', { limits });
  const turn = { id: 'u', status: 'failed', error: { message: 'You hit your usage limit.', codexErrorInfo: 'usageLimitExceeded' } };
  assert.deepEqual(mapNotification('turn/completed', { threadId: 't', turn }, s), [
    { threadId: 'h1', type: 'limit', resetsAt: '2026-10-12T12:34:15.000Z' },
    { threadId: 'h1', type: 'turn-end', status: 'failed', error: 'You hit your usage limit.' },
  ]);
  const other = mapNotification('turn/completed', { threadId: 't', turn: { ...turn, error: { message: 'x', codexErrorInfo: 'serverOverloaded' } } }, s);
  assert.deepEqual(other.map((e) => e.type), ['turn-end']);
});

test('one app-server per account: threads route to their profile account and never share a server', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = path.join(home, 'codex');
  writeFileSync(fake, FAKE_CODEX, { mode: 0o755 });
  const events: AgentEvent[] = [];
  const accounts: Record<string, { id: string; configDir?: string }> = { work: { id: 'work', configDir: path.join(home, 'work') }, side: { id: 'work', configDir: path.join(home, 'work') }, home: { id: 'default' } };
  const codex = new CodexAdapter((e) => events.push(e), async (spaceId) => accounts[spaceId], async () => ({ path: fake, env: process.env }));
  try {
    for (const [threadId, spaceId] of [['a', 'work'], ['b', 'side'], ['c', 'home']]) await codex.start(threadId, { provider: 'codex', spaceId, cwd: home, prompt: 'hi' });
    await new Promise((r) => setTimeout(r, 200));
    const sessions = Object.fromEntries(events.flatMap((e) => (e.type === 'session' ? [[e.threadId, e.sessionId]] : [])));
    const [a, b, c] = ['a', 'b', 'c'].map((t) => JSON.parse(sessions[t]));
    assert.equal(a.pid, b.pid, 'two profiles sharing an account share its server');
    assert.notEqual(a.pid, c.pid, 'another account gets its own server');
    assert.deepEqual([a.home, c.home], [path.join(home, 'work'), null]);
    const ends = events.filter((e) => e.type === 'message').map((e) => [e.threadId, e.type === 'message' && JSON.parse(e.text).thread]);
    assert.deepEqual(ends, [['a', sessions.a], ['b', sessions.b], ['c', sessions.c]], 'every notification reaches the thread that started it');
  } finally {
    codex.dispose();
  }
});

test('side chat asks on the profile account, streams once per delta, and says when that account is signed out', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = path.join(home, 'codex');
  writeFileSync(fake, FAKE_CODEX, { mode: 0o755 });
  const events: AgentEvent[] = [];
  const accounts: Record<string, { id: string; configDir?: string }> = { work: { id: 'work', configDir: path.join(home, 'work') }, out: { id: 'out', configDir: path.join(home, 'out') } };
  const codex = new CodexAdapter((e) => events.push(e), async (spaceId) => accounts[spaceId], async () => ({ path: fake, env: process.env }));
  try {
    const chunks = await collect(codex.ask('work', 'Thread context', 'User: why?', undefined, new AbortController()));
    assert.equal(chunks.join(''), 'It reads User: why?', 'item/completed repeats a streamed message; it is not added twice');
    assert.deepEqual(events, [], 'an ask never emits thread events');
    await assert.rejects(collect(codex.ask('out', 'x', 'y', undefined, new AbortController())), /Codex is not logged in for this profile\. Run `CODEX_HOME=.*out codex login`/);
  } finally {
    codex.dispose();
  }
});

/** A stand-in `codex` speaking just enough app-server: thread ids carry its pid and CODEX_HOME, each turn echoes its thread. */
const FAKE_CODEX = `#!/usr/bin/env node
let n = 0, buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.method === 'initialize') send({ id: m.id, result: {} });
  if (m.method === 'account/read') send({ id: m.id, result: process.env.CODEX_HOME?.endsWith('out') ? { account: null, requiresOpenaiAuth: true } : { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  if (m.method === 'thread/start') { send({ id: m.id, result: { thread: { id: JSON.stringify({ pid: process.pid, home: process.env.CODEX_HOME ?? null, n: ++n, ephemeral: !!m.params.ephemeral }) } } }); }
  if (m.method === 'turn/start' && JSON.parse(m.params.threadId).ephemeral) { const threadId = m.params.threadId; send({ id: m.id, result: { turn: { id: 'u' + n } } }); for (const delta of ['It ', 'reads ', m.params.input.at(-1).text]) send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'u' + n, itemId: 'a', delta } }); send({ method: 'item/completed', params: { threadId, item: { type: 'agentMessage', id: 'a', text: 'dup' } } }); send({ method: 'turn/completed', params: { threadId, turn: { id: 'u' + n, status: 'completed' } } }); }
  else if (m.method === 'turn/start') { send({ id: m.id, result: { turn: { id: 'u' + n } } }); send({ method: 'item/completed', params: { threadId: m.params.threadId, item: { type: 'agentMessage', id: 'm' + Math.random(), text: JSON.stringify({ thread: m.params.threadId }) } } }); }
} });
`;

test('session info comes from thread/start and the MCP, skills and plugin lists', () => {
  const start = JSON.parse(fixture('plan').split('\n')[0]).result;
  assert.deepEqual(infoFromStart(start), { model: 'gpt-6-luna', cwd: '/tmp/scratch', permissionMode: 'untrusted · workspaceWrite', version: '0.155.1' });
  const mcp = { data: [{ name: 'docs', runtimeStatus: 'connected', tools: { search: {}, read: {} }, authStatus: 'unsupported' }, { name: 'linear', runtimeStatus: null, tools: {}, authStatus: 'notLoggedIn' }], nextCursor: null };
  const skills = { data: [{ cwd: '/r', skills: [{ name: 'ui', enabled: true }, { name: 'off', enabled: false }, { name: 'ui', enabled: true }], errors: [] }] };
  const plugins = { marketplaces: [{ name: 'm', plugins: [{ name: 'gh', installed: true, enabled: true, localVersion: '1.2.0', version: null }, { name: 'other', installed: false, enabled: false }] }] };
  assert.deepEqual(infoFromLists(mcp, skills, plugins), {
    mcpServers: [{ name: 'docs', status: 'connected', toolCount: 2 }, { name: 'linear', status: 'needs-auth', toolCount: 0 }],
    skills: ['ui'],
    plugins: [{ name: 'gh', version: '1.2.0' }],
  });
  assert.deepEqual(infoFromLists(null, null, null), {});
  assert.deepEqual(mapNotification('mcpServer/startupStatus/updated', { threadId: 'c1', name: 'docs', status: 'ready', error: null, failureReason: null }, threadState('h1', '/r')), [
    { threadId: 'h1', type: 'info', info: { mcpServers: [{ name: 'docs', status: 'connected' }] } },
  ]);
});

test('malformed params map to nothing; foreign server requests are left for an error reply', () => {
  const s = threadState('h1', '/x');
  for (const params of [null, [], { plan: 'x' }, { item: { type: 'commandExecution' } }, { tokenUsage: { total: {} } }, { turn: { status: 'weird' } }])
    for (const method of ['turn/plan/updated', 'item/started', 'thread/tokenUsage/updated', 'turn/completed']) assert.deepEqual(mapNotification(method, params, s), []);
  assert.equal(mapRequest('account/chatgptAuthTokens/refresh', { threadId: 't' }, 'k', s), null);
  assert.equal(mapRequest('item/permissions/requestApproval', { threadId: 't' }, 'k', s), null);
  assert.equal(codexThreadId({ threadId: 7 }), undefined);
});

test('queue answers become the decisions app-server expects', () => {
  const command = { method: 'item/commandExecution/requestApproval', questionIds: [] };
  assert.deepEqual(reply(command, { kind: 'allow' }), { decision: 'accept' });
  assert.deepEqual(reply(command, { kind: 'allow', forSession: true }), { decision: 'acceptForSession' });
  assert.deepEqual(reply(command, { kind: 'deny' }), { decision: 'decline' });
  assert.deepEqual(reply(command, { kind: 'deny', interrupt: true }), { decision: 'cancel' });
  assert.deepEqual(reply({ method: 'item/tool/requestUserInput', questionIds: ['q1', 'q2'] }, { kind: 'answer', answers: [['Redis', 'my own cache'], []] }), { answers: { q1: { answers: ['Redis', 'my own cache'] } } });
  const elicitation = { method: 'mcpServer/elicitation/request', questionIds: [] };
  assert.deepEqual(reply(elicitation, { kind: 'allow' }), { action: 'accept', content: {}, _meta: null });
  assert.deepEqual(reply(elicitation, { kind: 'deny' }), { action: 'decline', content: null, _meta: null });
});

test('an MCP tool approval becomes a tool approval card', () => {
  const s = threadState('h1', '/x');
  const params = { threadId: 't', turnId: 'u', serverName: 'mochi', mode: 'form', _meta: null, message: 'Allow create_thread?', requestedSchema: { type: 'object', properties: {} } };
  assert.deepEqual(mapRequest('mcpServer/elicitation/request', params, 'k', s), { threadId: 'h1', type: 'approval', requestId: 'k', kind: 'tool', title: 'Use mochi tool', detail: 'Allow create_thread?' });
  assert.equal(mapRequest('mcpServer/elicitation/request', { ...params, mode: 'url' }, 'k', s), null);
});

test('rpc: line framing, id correlation out of order, errors, timeouts and invalid lines', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const invalid: string[] = [];
  const requests: [RpcId, string][] = [];
  const rpc = new RpcClient(input, output, { onNotification: () => {}, onRequest: (id, method) => requests.push([id, method]), onInvalid: (reason) => invalid.push(reason) });
  const sent: { id: number; method: string }[] = [];
  output.on('data', (d: Buffer) => sent.push(...d.toString().trim().split('\n').map((l) => JSON.parse(l))));

  const a = rpc.request('a', {});
  const b = rpc.request('b', {});
  const c = rpc.request('c', {}, 20);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((m) => [m.id, m.method]), [[1, 'a'], [2, 'b'], [3, 'c']]);

  input.write('{"id":2,"result":"B"}\n{"id":1,"res');
  input.write('ult":"A"}\nnot json\n{"id":99,"result":1}\n{"id":"s1","method":"item/x","params":{}}\n');
  input.write('{"id":4,"method":"m","params":5}\n{"foo":1}\n');
  assert.equal(await a, 'A');
  assert.equal(await b, 'B');
  await assert.rejects(c, /timed out/);
  assert.deepEqual(requests, [['s1', 'item/x']]);
  assert.deepEqual(invalid, ['not JSON', 'response to an unknown request', 'params is not an object', 'no method and no id']);

  const d = rpc.request('d', {});
  input.write('{"id":4,"error":{"code":-32600,"message":"nope"}}\n');
  await assert.rejects(d, /nope/);
  const e = rpc.request('e', {});
  rpc.close('exited');
  await assert.rejects(e, /exited/);
});

test('parseMessage tells notifications, requests and responses apart', () => {
  assert.deepEqual(parseMessage('{"method":"initialized"}'), { kind: 'notification', method: 'initialized', params: {} });
  assert.deepEqual(parseMessage('{"id":0,"method":"x","params":{"a":1}}'), { kind: 'request', id: 0, method: 'x', params: { a: 1 } });
  assert.equal(parseMessage('{"id":1.5,"result":1}'), 'no method and no id');
  assert.equal(parseMessage('{"id":1}'), 'response without result or error');
});

// Array.fromAsync is past the TS lib target.
async function collect<T>(items: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

test('webSearch items name the query on completion and carry pages as links', () => {
  const s = threadState('h1', '/repo');
  const started = { type: 'webSearch', id: 'w1', query: '', action: null, results: null };
  assert.deepEqual(mapNotification('item/started', { threadId: 't', item: started }, s), [{ threadId: 'h1', type: 'tool', id: 'w1', phase: 'start', text: 'Search the web' }]);
  const done = { ...started, query: 'token bucket', action: { type: 'search', query: 'token bucket' }, results: [{ url: 'https://en.wikipedia.org/wiki/Token_bucket', title: 'Token bucket' }, { snippet: 'no url' }] };
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: done }, s), [{ threadId: 'h1', type: 'tool', id: 'w1', phase: 'end', text: 'Search token bucket', links: [{ url: 'https://en.wikipedia.org/wiki/Token_bucket', title: 'Token bucket' }] }]);
  const opened = { type: 'webSearch', id: 'w2', query: '', action: { type: 'openPage', url: 'https://redis.io/docs/' }, results: null };
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: opened }, s), [{ threadId: 'h1', type: 'tool', id: 'w2', phase: 'end', text: 'Fetch https://redis.io/docs/', links: [{ url: 'https://redis.io/docs/' }] }]);
});
