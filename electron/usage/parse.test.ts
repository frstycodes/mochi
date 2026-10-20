import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCwd, parseClaudeLine } from './claude.ts';
import { parseCodexLog } from './codex.ts';
import { parseLog } from './git.ts';
import { summarize, type UsageRecord } from './records.ts';

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
});

test('a response logged in two transcripts counts once, and only inside a root', () => {
  const r = parseClaudeLine(claudeLine('m1'))!;
  const outside: UsageRecord = { ...r, key: 'other', cwd: '/repo/app2' };
  const { tokens, sessions } = summarize([r, { ...r }, outside], ['/repo/app'], null);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].output, 20);
  assert.equal(sessions.length, 1);
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

test('git log parsing leaves out lockfiles and binaries, and marks merges', () => {
  const out = '\u001e1760000000 aaa\n10\t2\tsrc/a.ts\n500\t0\tpnpm-lock.yaml\n-\t-\tlogo.png\n\u001e1760000100 bbb ccc\n';
  assert.deepEqual(parseLog('/repo/app', out), [
    { repo: '/repo/app', at: 1760000000000, added: 10, removed: 2, isMerge: false },
    { repo: '/repo/app', at: 1760000100000, added: 0, removed: 0, isMerge: true },
  ]);
});
