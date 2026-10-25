import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { Schema } from 'effect';
import { AgentEvent, agentRpc, AgentStartOptions } from './agent.ts';

const recorded: Record<string, object[]> = JSON.parse(readFileSync(new URL('../fixtures/agent-events.json', import.meta.url), 'utf8'));
const events = Object.values(recorded).flat();
const decode = Schema.decodeUnknownSync(AgentEvent);
const encode = Schema.encodeSync(AgentEvent);

test('recorded Claude and Codex events, saved before versioning, decode as v1 and encode back with v', () => {
  for (const event of events) {
    const decoded = decode(event);
    assert.deepEqual(decoded, { ...event, v: 1 });
    assert.deepEqual(encode(decoded), { ...event, v: 1 });
    assert.deepEqual(decode(encode(decoded)), decoded);
  }
});

test('the recordings cover most event types', () => {
  const types = new Set(events.map((e) => (e as { type: string }).type));
  for (const type of ['session', 'info', 'message', 'tool', 'plan', 'subagent', 'task', 'approval', 'usage', 'turn-end']) assert.ok(types.has(type), type);
});

test('a key set to undefined, as IPC and the mappers send it, reads as absent', () => {
  const usage = { threadId: 't1', type: 'usage', inputTokens: 0, outputTokens: 0, contextUsed: 1250, contextMax: undefined };
  assert.deepEqual(decode(usage), { ...usage, v: 1 });
});

test('an event of an unknown type or a later version is refused', () => {
  assert.throws(() => decode({ threadId: 't', type: 'nope' }));
  assert.throws(() => decode({ v: 2, threadId: 't', type: 'notice', text: 'x' }));
  assert.throws(() => decode({ threadId: 't', type: 'message', text: 1, isDelta: false }));
});

test('IPC inputs carry the limits main checks by hand today', () => {
  const start = { provider: 'claude', spaceId: 'p', cwd: null, prompt: 'hi' };
  assert.deepEqual(Schema.decodeUnknownSync(AgentStartOptions)(start), start);
  assert.throws(() => Schema.decodeUnknownSync(AgentStartOptions)({ ...start, provider: 'codex', useApiKey: true }), /API key/);
  const send = Schema.decodeUnknownSync(agentRpc.send.input);
  assert.deepEqual(send(['t', 'hello', undefined, undefined, 'fast']), ['t', 'hello', undefined, undefined, 'fast']);
  assert.throws(() => send(['t', 'x'.repeat(100_001)]));
  assert.throws(() => Schema.decodeUnknownSync(agentRpc.readWidget.input)(['t', 's', 'https://x']));
});
