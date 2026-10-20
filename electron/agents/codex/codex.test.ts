import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { AgentEvent } from '../../../src/host/types/agent.ts';
import { CodexAdapter, imageModel, reply } from './adapter.ts';
import { changesPatch, codexModels, codexThreadId, commandsFromSkills, infoFromLists, infoFromStart, mapNotification, mapRequest, requestKey, skillEvents, skillInputs, threadState, updateLimits } from './map.ts';
import { parseMessage, RpcClient, type RpcId } from './rpc.ts';

// Fixtures are real `codex app-server` output, noisy methods filtered out: 0.155.1 (gpt-6-luna, approval policy `untrusted`), and 0.163.0 for `background*` (approval policy `never`).
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
  assert.deepEqual(tools.map((t) => [t.phase, t.text, t.exitCode]), [['start', 'touch c.txt', undefined], ['end', 'touch c.txt', 0]]);

  const approval = events.find((e) => e.type === 'approval')!;
  assert.deepEqual(approval, { threadId: 'h1', type: 'approval', requestId: 'codex:default:number:0', kind: 'command', title: 'Run a command', detail: 'In /tmp/scratch', code: "/bin/zsh -lc 'touch c.txt'" });
  assert.deepEqual(events.find((e) => e.type === 'resolved'), { threadId: 'h1', type: 'resolved', requestId: 'codex:default:number:0' });

  const usage = events.filter((e) => e.type === 'usage');
  assert.deepEqual(usage.map((u) => [u.inputTokens, u.outputTokens]), [[21292, 164], [42776 - 21292, 209 - 164], [64329 - 42776, 214 - 209]], 'usage carries per-update differences, since the store sums them');
  assert.deepEqual([usage[0].contextUsed, usage[0].contextMax], [21456, 258400]);
  assert.ok(usage.every((u) => u.costUsd === undefined), 'Codex reports no spend, so none is made up');

  assert.deepEqual(events.at(-1), { threadId: 'h1', type: 'turn-end', status: 'done' });
});

test('a message that never streamed arrives whole from item/completed, once', () => {
  const s = threadState('h1', '/x');
  const item = { type: 'agentMessage', id: 'm1', text: 'hello' };
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item }, s), [{ threadId: 'h1', type: 'message', text: 'hello', isDelta: false }]);
  mapNotification('item/agentMessage/delta', { threadId: 't', itemId: 'm2', delta: 'hi' }, s);
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: { ...item, id: 'm2' } }, s), []);
});

test('a context compaction item is the compaction starting and ending', () => {
  const s = threadState('h1', '/repo');
  const item = { type: 'contextCompaction', id: 'c1' };
  assert.deepEqual(mapNotification('item/started', { threadId: 't', item }, s), [{ threadId: 'h1', type: 'compaction', phase: 'start' }]);
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item }, s), [{ threadId: 'h1', type: 'compaction', phase: 'end' }]);
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
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: { ...item, status: 'completed' } }, s).at(0), {
    threadId: 'h1',
    type: 'tool',
    id: 'f1',
    phase: 'end',
    text: 'Edit src/a.ts, b.ts',
    files: ['src/a.ts', 'b.ts'],
    patch: ['diff --git a/b.ts b/b.ts', '--- /dev/null', '+++ b/b.ts'].join('\n'),
  });
});

test('after a resume only the reported request counts, not the whole history', () => {
  const s = threadState('h1', '/x', { isResumed: true });
  const tokenUsage = { total: { inputTokens: 90_000, cachedInputTokens: 0, outputTokens: 900, totalTokens: 90_900 }, last: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 10, totalTokens: 1010 }, modelContextWindow: null };
  const [u] = mapNotification('thread/tokenUsage/updated', { threadId: 't', tokenUsage }, s);
  assert.deepEqual(u.type === 'usage' && [u.inputTokens, u.outputTokens, u.contextMax], [1000, 10, undefined]);
});

test('a usage limit pauses the thread with the account-wide reset time, then ends the turn', () => {
  const limits = {};
  updateLimits(limits, { rateLimits: { primary: { usedPercent: 89, windowDurationMins: 300, resetsAt: 1791808455 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1792000000 } } });
  updateLimits(limits, { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1791808455 } } });
  updateLimits(limits, { rateLimits: { primary: null, secondary: null } });
  const s = threadState('h1', '/x', { limits });
  const turn = { id: 'u', status: 'failed', error: { message: 'You hit your usage limit.', codexErrorInfo: 'usageLimitExceeded' } };
  assert.deepEqual(mapNotification('turn/completed', { threadId: 't', turn }, s), [
    { threadId: 'h1', type: 'limit', resetsAt: '2026-10-12T12:34:15.000Z', label: '5-hour' },
    { threadId: 'h1', type: 'turn-end', status: 'failed', error: 'You hit your usage limit.' },
  ]);
  const rate = mapNotification('turn/completed', { threadId: 't', turn: { ...turn, error: { message: 'x', codexErrorInfo: 'rateLimitExceeded' } } }, s);
  assert.deepEqual(rate.map((e) => e.type), ['limit', 'turn-end']);
  const other = mapNotification('turn/completed', { threadId: 't', turn: { ...turn, error: { message: 'x', codexErrorInfo: 'serverOverloaded' } } }, s);
  assert.deepEqual(other.map((e) => e.type), ['turn-end']);
});

test('one app-server per account: threads route to their profile account and never share a server', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, FAKE_CODEX);
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
  const fake = fakeCodex(home, FAKE_CODEX);
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

test('a thread runs at the speed it started with, and a message changes it for its turn and the ones after', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, TIER_CODEX);
  const log = path.join(home, 'tiers.log');
  const events: AgentEvent[] = [];
  const codex = new CodexAdapter((e) => events.push(e), async () => ({ id: 'default' }), async () => ({ path: fake, env: { ...process.env, TIER_LOG: log } }));
  // Lets each turn end before the next send.
  const settle = () => new Promise((r) => setTimeout(r, 150));
  try {
    await codex.start('t', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'hi', speed: 'priority', effort: 'max' });
    assert.ok(events.some((e) => e.type === 'info' && e.info.effort === 'max'));
    await settle();
    await codex.send('t', 'again');
    await settle();
    await codex.send('t', 'slower', undefined, undefined, '');
    await settle();
    await codex.send('t', 'faster', undefined, undefined, 'priority');
    await settle();
    await codex.start('u', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'hi' });
    const expected = ['thread/start priority', 'turn/start priority', 'turn/start priority', 'turn/start null', 'turn/start priority', 'thread/start null', 'turn/start null'];
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), expected);
  } finally {
    codex.dispose();
  }
});

test('images go to turn/start as data-URL image inputs ahead of the text, on the first prompt and on a send', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, TIER_CODEX);
  const log = path.join(home, 'inputs.log');
  const codex = new CodexAdapter(() => {}, async () => ({ id: 'default' }), async () => ({ path: fake, env: { ...process.env, TIER_LOG: path.join(home, 'tiers.log'), INPUT_LOG: log } }));
  const png = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' };
  try {
    await codex.start('t', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'what is this?', images: [png] });
    await new Promise((r) => setTimeout(r, 150));
    await codex.send('t', 'and this?', [{ mediaType: 'image/webp', data: 'UklGRg==' }]);
    const inputs = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(inputs, [
      [{ type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'text', text: 'what is this?', text_elements: [] }],
      [{ type: 'image', url: 'data:image/webp;base64,UklGRg==' }, { type: 'text', text: 'and this?', text_elements: [] }],
    ]);
  } finally {
    codex.dispose();
  }
});

test('an interrupt while Codex has not answered turn/start ends the start at once as interrupted, and stops the turn if it starts after all', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, STUCK_CODEX);
  const log = path.join(home, 'stuck.log');
  const events: AgentEvent[] = [];
  const codex = new CodexAdapter((e) => events.push(e), async () => ({ id: 'default' }), async () => ({ path: fake, env: { ...process.env, STUCK_LOG: log } }));
  const logged = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  try {
    const starting = codex.start('t', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'hi' });
    for (let i = 0; i < 100 && !logged().includes('turn/start'); i++) await new Promise((r) => setTimeout(r, 20));
    const startedAt = performance.now();
    await codex.interrupt('t');
    await starting;
    assert.ok(performance.now() - startedAt < 1000, 'neither call waits out an RPC timeout');
    assert.deepEqual(events.filter((e) => e.type === 'turn-end'), [{ threadId: 't', type: 'turn-end', status: 'interrupted' }]);
    // The fake answers turn/start only once interrupted: that late turn is stopped.
    for (let i = 0; i < 100 && !logged().includes('turn/interrupt late-1'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(logged(), ['turn/start', 'turn/interrupt late-1']);
  } finally {
    codex.dispose();
  }
});

/** Answers turn/start 300 ms late, after the client has given up on it; logs turn/start and turn/interrupt to $STUCK_LOG. */
const STUCK_CODEX = `#!/usr/bin/env node
const fs = require('node:fs');
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.method === 'turn/start') { fs.appendFileSync(process.env.STUCK_LOG, 'turn/start\\n'); setTimeout(() => send({ id: m.id, result: { turn: { id: 'late-1' } } }), 300); }
  else if (m.method === 'turn/interrupt') { fs.appendFileSync(process.env.STUCK_LOG, 'turn/interrupt ' + m.params.turnId + '\\n'); send({ id: m.id, result: {} }); }
  else if (m.method === 'account/read') send({ id: m.id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  else if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'c1' } } });
  else if (m.id !== undefined) send({ id: m.id, result: {} });
} });
`;

/** Logs the `serviceTier` of every thread/start and turn/start to $TIER_LOG (and turn/start's input to $INPUT_LOG); each turn completes shortly after its reply. */
const TIER_CODEX = `#!/usr/bin/env node
const fs = require('node:fs');
let buf = '', n = 0;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
// Later than the reply, as a real turn ends: the adapter records the turn id from the reply.
const done = (threadId, id) => setTimeout(() => send({ method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } }), 20);
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (['thread/start', 'turn/start'].includes(m.method)) fs.appendFileSync(process.env.TIER_LOG, m.method + ' ' + m.params.serviceTier + '\\n');
  if (m.method === 'turn/start' && process.env.INPUT_LOG) fs.appendFileSync(process.env.INPUT_LOG, JSON.stringify(m.params.input) + '\\n');
  if (m.method === 'account/read') send({ id: m.id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  else if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'c' + ++n } } });
  else if (m.method === 'turn/start') { const id = 'u' + ++n; send({ id: m.id, result: { turn: { id } } }); done(m.params.threadId, id); }
  else if (m.id !== undefined) send({ id: m.id, result: {} });
} });
`;

/** A stand-in `codex` speaking just enough app-server: thread ids carry its pid and CODEX_HOME, each turn echoes its thread. */
/**
 * A fake `codex` from a node script. Windows can't run a shebang script, so there it is a `.cmd` shim next to the script,
 * the same shape as an npm-installed codex, which also exercises how the adapter spawns shims.
 */
function fakeCodex(home: string, source: string) {
  const script = path.join(home, 'codex.cjs');
  writeFileSync(script, source, { mode: 0o755 });
  if (process.platform !== 'win32') return script;
  const shim = path.join(home, 'codex.cmd');
  writeFileSync(shim, `@node "%~dp0codex.cjs" %*\r\n`);
  return shim;
}

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
    commands: [{ name: 'ui', description: '' }],
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
  const done = { ...started, query: 'token bucket', action: { type: 'search', query: 'token bucket' }, results: [{ type: 'text_result', domain: 'en.wikipedia.org', ref_id: 'turn0search12', snippet: 'A token bucket…', title: 'Token bucket', url: 'https://en.wikipedia.org/wiki/Token_bucket' }, { type: 'image_result' }] };
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: done }, s), [{ threadId: 'h1', type: 'tool', id: 'w1', phase: 'end', text: 'Search token bucket', links: [{ url: 'https://en.wikipedia.org/wiki/Token_bucket', title: 'Token bucket' }] }]);
  const opened = { type: 'webSearch', id: 'w2', query: '', action: { type: 'openPage', url: 'https://redis.io/docs/' }, results: null };
  assert.deepEqual(mapNotification('item/completed', { threadId: 't', item: opened }, s), [{ threadId: 'h1', type: 'tool', id: 'w2', phase: 'end', text: 'Fetch https://redis.io/docs/', links: [{ url: 'https://redis.io/docs/' }] }]);
});

test('model/list maps to the picker: real ids, names, default flag, efforts and speed tiers; hidden models stay out', () => {
  // Shape of a real 0.155.1 `model/list` result on a ChatGPT account, trimmed to two models plus a hidden one.
  const result = {
    data: [
      { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', hidden: false, isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'ultra', description: '' }], additionalSpeedTiers: ['fast'], serviceTiers: [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }], defaultServiceTier: null },
      { id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', hidden: false, isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }] },
      { id: 'internal', model: 'internal', displayName: 'Internal', description: '', hidden: true, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] },
    ],
    nextCursor: null,
  };
  assert.deepEqual(codexModels(result), [
    { id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', efforts: ['low', 'ultra'], defaultEffort: 'low', speeds: [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }], isDefault: true },
    { id: 'gpt-6-luna', name: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', efforts: ['medium'], defaultEffort: 'medium', speeds: [], isDefault: false },
  ]);
  assert.deepEqual(codexModels(null), []);
});

test('a spawned agent becomes a subagent of its thread with its own steps, result and tokens (real 0.155.1 trace)', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, REPLAY_CODEX);
  const events: AgentEvent[] = [];
  const codex = new CodexAdapter((e) => events.push(e), async () => ({ id: 'default' }), async () => ({ path: fake, env: { ...process.env, FIXTURE: fileURLToPath(new URL('./fixtures/subagent.jsonl', import.meta.url)) } }));
  try {
    await codex.start('h1', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'Spawn one sub-agent' });
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'turn-end'); i++) await new Promise((r) => setTimeout(r, 20));
    const child = '01a1317e-8947-7c73-866e-ec3ce63a621b';
    const subagent = events.filter((e) => e.type === 'subagent');
    assert.ok(subagent.every((e) => e.threadId === 'h1' && e.id === child), 'the child reports as a subagent of the thread that spawned it');
    assert.deepEqual(subagent[0], { threadId: 'h1', type: 'subagent', id: child, phase: 'start', toolId: 'call_03dd2329246e48cbaa23dd501478dcfa', name: 'echo hi', isBackground: true });
    const steps = subagent.flatMap((e) => (e.step ? [[e.step.phase, e.step.text, e.step.exitCode]] : []));
    assert.deepEqual(steps, [['start', 'echo hi', undefined], ['end', 'echo hi', 0]]);
    assert.deepEqual(subagent.flatMap((e) => (e.message ? [e.message] : [])), ['hi']);
    assert.equal(subagent.findLast((e) => e.tokens)?.tokens, 42727);
    assert.deepEqual(subagent.filter((e) => e.phase === 'end').map((e) => e.status), ['done', 'done'], 'both the parent item and the child turn end it; the store keeps the first');
    const childTools = events.filter((e) => e.type === 'tool' && e.text.includes('echo hi'));
    assert.deepEqual(childTools, [], "the child's command stays out of the parent's work log");
    const usage = events.filter((e) => e.type === 'usage' && e.contextUsed === undefined);
    assert.ok(usage.length >= 1, "the child's spend counts toward the thread without moving its context meter");
    assert.deepEqual(events.filter((e) => e.type === 'message').map((e) => e.type === 'message' && e.text), ['I’ll spawn one sub-agent and wait for its output.\n', 'done']);
  } finally {
    codex.dispose();
  }
});

test('a command still running when the turn ends is a background task that ends with its exit (real 0.163.0 trace)', () => {
  const { events } = replay('background');
  const id = 'exec-5d520426-9a8e-4ff3-911c-41db88751dee';
  const tail = events.filter((e) => e.type === 'task' || e.type === 'turn-end');
  assert.deepEqual(tail, [
    { threadId: 'h1', type: 'task', id, phase: 'start', kind: 'shell', command: "sh -c 'sleep 25; echo finished; exit 3'" },
    { threadId: 'h1', type: 'turn-end', status: 'done' },
    { threadId: 'h1', type: 'task', id, phase: 'end', status: 'failed', exitCode: 3 },
  ]);
  assert.equal(replay('plan').events.filter((e) => e.type === 'task').length, 0, 'a command that finished inside its turn is no task');
});

test('stopping a background task terminates its terminal and ends it stopped, not failed (real 0.163.0 trace)', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, STOP_CODEX);
  const events: AgentEvent[] = [];
  const codex = new CodexAdapter((e) => events.push(e), async () => ({ id: 'default' }), async () => ({ path: fake, env: { ...process.env, FIXTURE: fileURLToPath(new URL('./fixtures/background-stop.jsonl', import.meta.url)) } }));
  const id = 'exec-aaec80e8-e146-42a6-babd-b605b1490725';
  const ended = () => events.find((e) => e.type === 'task' && e.phase === 'end');
  try {
    await codex.start('h1', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'Start sleep 600 in the background' });
    for (let i = 0; i < 50 && !events.some((e) => e.type === 'turn-end'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(events.some((e) => e.type === 'task' && e.phase === 'start' && e.id === id));
    assert.equal(ended(), undefined, 'still running after the turn');
    await codex.stopTask('h1', id);
    for (let i = 0; i < 50 && !ended(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(ended(), { threadId: 'h1', type: 'task', id, phase: 'end', status: 'stopped', exitCode: 137 });
  } finally {
    codex.dispose();
  }
});

/** Replays a background-terminal trace (`FIXTURE`) but holds its last line, the terminal's exit, until `thread/backgroundTerminals/terminate`. */
const STOP_CODEX = `#!/usr/bin/env node
const lines = require('fs').readFileSync(process.env.FIXTURE, 'utf8').split('\\n').filter(Boolean);
const exit = JSON.parse(lines.pop()).params.item;
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: JSON.parse(lines[0]).params.threadId } } });
  else if (m.method === 'turn/start') { send({ id: m.id, result: { turn: { id: 't' } } }); for (const l of lines) process.stdout.write(l + '\\n'); }
  else if (m.method === 'thread/backgroundTerminals/list') send({ id: m.id, result: { data: [{ itemId: exit.id, processId: exit.processId }], nextCursor: null } });
  else if (m.method === 'thread/backgroundTerminals/terminate') { const ok = m.params.processId === exit.processId; send({ id: m.id, result: { terminated: ok } }); if (ok) send({ method: 'item/completed', params: { item: exit, threadId: m.params.threadId } }); }
  else if (m.id !== undefined) send({ id: m.id, result: m.method === 'account/read' ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } : {} });
} });
`;

/** A stand-in `codex` that answers a turn by replaying a recorded trace (`FIXTURE`), under the recorded parent thread id. */
const REPLAY_CODEX = `#!/usr/bin/env node
const lines = require('fs').readFileSync(process.env.FIXTURE, 'utf8').split('\\n').filter(Boolean);
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.method === 'initialize') send({ id: m.id, result: {} });
  if (m.method === 'account/read') send({ id: m.id, result: { account: { type: 'chatgpt' }, requiresOpenaiAuth: true } });
  if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: '01a1317e-69af-74d1-afc6-f77fec141215' } } });
  if (m.method === 'turn/start') { send({ id: m.id, result: { turn: { id: 't' } } }); for (const l of lines) process.stdout.write(l + '\\n'); }
  if (m.id !== undefined && !['initialize', 'account/read', 'thread/start', 'turn/start'].includes(m.method)) send({ id: m.id, result: {} });
} });
`;

test('skills/list becomes / commands, and a message opening with one attaches its skill item', () => {
  const reply = {
    data: [
      {
        cwd: '/repo',
        skills: [
          { name: 'fix-lint', description: 'Long description', interface: { shortDescription: 'Fix lint' }, path: '/s/fix-lint/SKILL.md', enabled: true },
          { name: 'off', description: 'Disabled', path: '/s/off/SKILL.md', enabled: false },
          { name: 'plain', description: 'Plain one', path: '/s/plain/SKILL.md', enabled: true },
        ],
      },
      { cwd: '/other', skills: [{ name: 'plain', description: 'Duplicate', path: '/x/SKILL.md', enabled: true }] },
    ],
  };
  const commands = commandsFromSkills(reply);
  assert.deepEqual(commands, [
    { name: 'fix-lint', description: 'Fix lint', path: '/s/fix-lint/SKILL.md' },
    { name: 'plain', description: 'Plain one', path: '/s/plain/SKILL.md' },
  ]);
  assert.deepEqual(skillInputs('/fix-lint src/a.ts', [], commands), [{ type: 'skill', name: 'fix-lint', path: '/s/fix-lint/SKILL.md' }]);
  assert.deepEqual(skillInputs('/off', [], commands), []);
  assert.deepEqual(skillInputs('please /plain', [], commands), []);
  assert.deepEqual(
    skillInputs('/fix-lint a.ts', ['plain', 'fix-lint', 'gone'], commands).map((s) => s.name),
    ['fix-lint', 'plain'],
    'skills picked with @ attach too, once each, unknown ones left out',
  );
  assert.deepEqual(
    skillEvents('t1', 'turn-1', [{ name: 'plain' }]).map((e) => e.type === 'tool' && [e.phase, e.text, e.skill]),
    [
      ['start', 'Skill plain', 'plain'],
      ['end', 'Skill plain', 'plain'],
    ],
  );
  assert.deepEqual(infoFromLists(null, reply, null).skills, ['fix-lint', 'plain']);
  assert.deepEqual(commandsFromSkills(null), []);
});

test("a completed file change carries one patch with a section per file, so each file's +/− and diff show", () => {
  const changes = [
    { path: '/repo/src/a.ts', kind: { type: 'update', move_path: null }, diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n same\n' },
    { path: '/repo/src/new.ts', kind: { type: 'add' }, diff: 'one\ntwo\n' },
    { path: '/repo/gone.ts', kind: { type: 'delete' }, diff: 'bye\n' },
  ];
  const s = threadState('h1', '/repo');
  const [end] = mapNotification('item/completed', { threadId: 't', item: { type: 'fileChange', id: 'f2', status: 'completed', changes } }, s);
  assert.equal(
    end.type === 'tool' && end.patch,
    [
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,2 @@', '-old', '+new', ' same',
      'diff --git a/src/new.ts b/src/new.ts', '--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1,2 @@', '+one', '+two',
      'diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-bye',
    ].join('\n'),
  );
  assert.equal(changesPatch([{ path: '/repo/x.ts', kind: { type: 'update', move_path: null }, diff: '' }], '/repo'), '', 'an update without hunks adds nothing');
});

test("image generation runs on a model the account lists: the cheap one, else its default, never the user's config default", () => {
  const model = (id: string, isDefault = false) => ({ id, name: id, description: '', efforts: [], speeds: [], isDefault });
  assert.equal(imageModel([model('gpt-6-astra', true), model('gpt-6-luna')]), 'gpt-6-luna');
  assert.equal(imageModel([model('gpt-6-nova'), model('gpt-6-astra', true)]), 'gpt-6-astra');
  assert.equal(imageModel([model('gpt-6-nova')]), 'gpt-6-nova');
  assert.equal(imageModel([]), null);
});

// A turn that runs one command 150ms in, then waits; a steer is echoed as a userMessage item carrying its clientId.
const STEER_CODEX = `#!/usr/bin/env node
const fs = require('node:fs');
let buf = '', n = 0;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  const threadId = m.params?.threadId;
  if (m.method === 'account/read') send({ id: m.id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } });
  else if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'c' + ++n } } });
  else if (m.method === 'turn/start') {
    send({ id: m.id, result: { turn: { id: 'u1' } } });
    const item = { type: 'commandExecution', id: 'x1', command: 'pnpm test', commandActions: [{ command: 'pnpm test' }] };
    setTimeout(() => { send({ method: 'item/started', params: { threadId, item } }); send({ method: 'item/completed', params: { threadId, item: { ...item, exitCode: 0 } } }); }, 150);
  } else if (m.method === 'turn/steer') {
    fs.appendFileSync(process.env.STEER_LOG, m.params.input.at(-1).text + ' ' + m.params.clientUserMessageId + '\\n');
    send({ id: m.id, result: { turnId: 'u1' } });
    send({ method: 'item/started', params: { threadId, item: { type: 'userMessage', id: 'um', clientId: m.params.clientUserMessageId, content: m.params.input } } });
  } else if (m.id !== undefined) send({ id: m.id, result: {} });
} });
`;

test('a steer waits in Mochi until the turn finishes a step, can be taken back until then, and is read when Codex echoes it', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-fake-'));
  const fake = fakeCodex(home, STEER_CODEX);
  const log = path.join(home, 'steers.log');
  const events: AgentEvent[] = [];
  const codex = new CodexAdapter((e) => events.push(e), async () => ({ id: 'default' }), async () => ({ path: fake, env: { ...process.env, STEER_LOG: log } }));
  try {
    await codex.start('t', { provider: 'codex', spaceId: 'home', cwd: home, prompt: 'run the tests' });
    await codex.send('t', 'create a PR', undefined, undefined, undefined, true, 's1');
    await codex.send('t', 'never mind', undefined, undefined, undefined, true, 's2');
    assert.equal(existsSync(log), false, 'nothing reaches Codex before the step ends');
    assert.equal(await codex.unsteer('t', 's2'), true);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['create a PR s1'], 'the taken-back message never went');
    const order = events.flatMap((e) => (e.type === 'tool' && e.phase === 'end' ? ['tool end'] : e.type === 'steer-read' ? [`read ${e.id}`] : []));
    assert.deepEqual(order, ['tool end', 'read s1']);
    assert.equal(await codex.unsteer('t', 's1'), false, 'handed over, it can no longer be taken back');
  } finally {
    codex.dispose();
  }
});
