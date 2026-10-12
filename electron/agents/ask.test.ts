import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentAskContext } from '../../src/host/types/agent.ts';
import { migrateSettings } from '../../src/host/types/settings.ts';
import { askModelOf, sideChatChoice } from '../../src/runtime/controls.ts';
import { ask, type Asker } from './ask.ts';

const context: AgentAskContext = { spaceId: 'work', title: 'Rate limiter', goal: 'Add a rate limiter', steps: [], activity: [], diff: null };

test('a side chat choice reaches its own provider with the same context, on the real model id', async () => {
  const calls: unknown[][] = [];
  const asker = (provider: string): Asker =>
    async function* (...args) {
      calls.push([provider, ...args.slice(0, 4)]);
      yield `from ${provider}`;
    };
  const askers = { claude: asker('claude'), codex: asker('codex') };
  const answer = async (model: string, provider: 'claude' | 'codex') => (await collect(ask(askers, context, [{ role: 'user', text: 'Why?' }], askModelOf({ provider, model }), new AbortController()))).join('');

  assert.equal(await answer('sonnet-5.5', 'claude'), 'from claude');
  assert.equal(await answer('gpt-5.5', 'codex'), 'from codex');
  assert.equal(await answer('my-gpt', 'codex'), 'from codex', 'a model the catalog does not list keeps its provider');
  assert.deepEqual(
    calls.map(([provider, spaceId, , prompt, model]) => [provider, spaceId, prompt, model]),
    [
      ['claude', 'work', 'User: Why?', 'claude-sonnet-5-5'],
      ['codex', 'work', 'User: Why?', undefined],
      ['codex', 'work', 'User: Why?', 'my-gpt'],
    ],
    "Codex's catalog entries carry no real id, so they run the account's default",
  );
  assert.equal(calls[0][2], calls[1][2], 'both providers get the same instructions');
  assert.match(calls[0][2] as string, /Add a rate limiter/);
});

test('the Claude-only side chat setting migrates to a Claude choice the chip can show', () => {
  const migrated = migrateSettings({ concurrency: 4, sideChatModel: 'claude-opus-5-5' });
  assert.deepEqual(migrated, { concurrency: 4, sideChatModel: { provider: 'claude', model: 'claude-opus-5-5' } });
  assert.deepEqual(sideChatChoice(migrated.sideChatModel!), { provider: 'claude', model: 'opus-5.5' });
  assert.deepEqual(migrateSettings({ sideChatModel: { provider: 'codex', model: 'gpt-5.5' } }), { sideChatModel: { provider: 'codex', model: 'gpt-5.5' } });
});

// Array.fromAsync is past the TS lib target.
async function collect<T>(items: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}
