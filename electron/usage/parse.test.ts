import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCwd, parseClaudeLine } from './claude.ts';
import { parseCodexLog } from './codex.ts';
import { parseLog } from './git.ts';
import { builtInRates, liteLlmBook, responseCost } from './prices.ts';
import { rootOf, summarize, type UsageRecord } from './records.ts';

const claudeLine = (id: string, extra: object = {}) =>
  JSON.stringify({
    timestamp: '2026-10-12T08:00:00.000Z',
    cwd: '/repo/app',
    sessionId: 's1',
    requestId: 'r1',
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 20 } } },
    ...extra,
  });

test('a Claude line splits cache writes into 5-minute and 1-hour, and skips synthetic messages', () => {
  const r = parseClaudeLine(claudeLine('m1'))!;
  assert.deepEqual([r.input, r.output, r.cacheRead, r.cacheWrite5m, r.cacheWrite1h], [10, 20, 300, 30, 20]);
  assert.equal(parseClaudeLine(claudeLine('m2', { message: { id: 'm2', model: '<synthetic>', usage: {} } })), null);
  assert.equal(parseClaudeLine('{"type":"user"}'), null);
  assert.equal(encodeCwd('/Users/me/dev/app.v2'), '-Users-me-dev-app-v2');
  assert.equal(rootOf('/tmp/x', ['/', '/repo']), '/');
  assert.equal(rootOf('/repo/a', ['/', '/repo']), '/repo');
});

test('a response logged on several lines counts once with its final counts, and only inside a root', () => {
  const r = parseClaudeLine(claudeLine('m1'))!;
  // Claude Code streams a response: an early line carries a partial output count.
  const partial: UsageRecord = { ...r, output: 2 };
  const outside: UsageRecord = { ...r, key: 'other', cwd: '/repo/app2' };
  const { tokens, sessions } = summarize([partial, r, { ...r }, outside], ['/repo/app'], null, builtInRates);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].output, 20);
  assert.equal(sessions.length, 1);
  // Opus 5.5: 10 in × $4, 20 out × $20, 300 reads × $0.20, 30 five-minute writes × $5, 20 one-hour writes × $8, per million.
  const c = tokens[0].cost!;
  assert.ok(Math.abs(c.input + c.output + c.cacheRead + c.cacheWrite - (10 * 4 + 20 * 20 + 300 * 0.2 + 30 * 5 + 20 * 8) / 1e6) < 1e-12);
});

test('LiteLLM rates: provider and date fallbacks, 1-hour writes, and a long-context tier for the whole request', () => {
  const book = liteLlmBook({
    'anthropic/claude-x-1': { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6, cache_read_input_token_cost: 1e-7, cache_creation_input_token_cost: 1.25e-6, cache_creation_input_token_cost_above_1hr: 2e-6 },
    'gpt-y': { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 2e-7, input_cost_per_token_above_272k_tokens: 4e-6, output_cost_per_token_above_272k_tokens: 1.5e-5, cache_read_input_token_cost_above_272k_tokens: 4e-7, input_cost_per_token_batches: 1e-6 },
  });
  assert.equal(book('claude-x-1-20260101')?.cacheWrite1h, 2e-6);
  assert.equal(book('unknown'), null);
  const gpt = book('gpt-y')!;
  assert.deepEqual(gpt.tiers.map((t) => [t.above, t.input, t.cacheRead]), [[272_000, 4e-6, 4e-7]]);
  const base = { key: null, at: 0, harness: 'codex' as const, model: 'gpt-y', cwd: '/', sessionId: '', output: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  assert.equal(responseCost({ ...base, input: 1000, cacheRead: 100_000 }, gpt).cacheRead, 100_000 * 2e-7);
  assert.equal(responseCost({ ...base, input: 1000, cacheRead: 300_000 }, gpt).cacheRead, 300_000 * 4e-7);
  assert.equal(builtInRates('claude-haiku-4-5-20251001')?.input, 1e-6);
});

test('Codex counts each new running total once, with cached input taken out of input', async () => {
  const count = (total: number, input: number, cached: number) => ({ timestamp: '2026-10-13T08:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 5 } } } });
  const lines = [
    { type: 'session_meta', payload: { id: 'c1', cwd: '/repo/app' } },
    { type: 'turn_context', payload: { model: 'gpt-6-astra' } },
    count(100, 80, 30),
    count(100, 80, 30),
    count(200, 90, 60),
  ].map((l) => JSON.stringify(l));
  const records = await parseCodexLog((async function* () { yield* lines; })());
  assert.deepEqual(records.map((r) => [r.model, r.input, r.cacheRead]), [['gpt-6-astra', 50, 30], ['gpt-6-astra', 30, 60]]);
});

test('Codex prefers per-response usage records for its own thread, and keeps its first session_meta', async () => {
  const at = '2026-10-13T08:00:00Z';
  const record = (thread: string, id: string, input: number) => ({ timestamp: at, type: 'token_usage_record', payload: { thread_id: thread, response_id: id, usage: { input_tokens: input, cached_input_tokens: 10, output_tokens: 3 } } });
  const lines = [
    { timestamp: at, type: 'session_meta', payload: { id: 'child', cwd: '/repo/app' } },
    { timestamp: at, type: 'session_meta', payload: { id: 'parent', cwd: '/elsewhere' } },
    { timestamp: at, type: 'turn_context', payload: { model: 'gpt-6-astra' } },
    record('child', 'r1', 50),
    record('parent', 'r0', 999),
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1 }, last_token_usage: { input_tokens: 7, cached_input_tokens: 0, output_tokens: 1 } } } },
    record('child', 'r2', 30),
  ].map((l) => JSON.stringify(l));
  const records = await parseCodexLog((async function* () { yield* lines; })());
  assert.deepEqual(records.map((r) => [r.key, r.input, r.cwd, r.sessionId]), [['codex\u0000r1', 40, '/repo/app', 'child'], ['codex\u0000r2', 20, '/repo/app', 'child']]);
});

test('git log parsing leaves out lockfiles and binaries, and marks merges', () => {
  const out = '\u001e1760000000 aaa\n10\t2\tsrc/a.ts\n500\t0\tpnpm-lock.yaml\n-\t-\tlogo.png\n\u001e1760000100 bbb ccc\n';
  assert.deepEqual(parseLog('/repo/app', out), [
    { repo: '/repo/app', at: 1760000000000, added: 10, removed: 2, isMerge: false },
    { repo: '/repo/app', at: 1760000100000, added: 0, removed: 0, isMerge: true },
  ]);
});
