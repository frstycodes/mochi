import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { AgentAskContext } from '../../../../src/host/types/agent.ts';
import {
  migrateSettings,
  type ModelChoice,
} from '../../../../src/host/types/settings.ts';
import { sideChatChoice } from '../../../../src/runtime/controls.ts';
import { ask, utility, type Asker } from './ask.ts';

const context: AgentAskContext = {
  spaceId: 'work',
  title: 'Rate limiter',
  goal: 'Add a rate limiter',
  steps: [],
  activity: [],
  diff: null,
};

test('a side chat choice reaches its own provider with the same context, on the real model id', async () => {
  const calls: unknown[][] = [];
  const asker = (provider: string): Asker =>
    async function* (...args) {
      calls.push([provider, ...args.slice(0, 4)]);
      yield `from ${provider}`;
    };
  const askers = { claude: asker('claude'), codex: asker('codex') };
  const answer = async (model: string, provider: 'claude' | 'codex') =>
    (
      await collect(
        ask(
          askers,
          context,
          [{ role: 'user', text: 'Why?' }],
          { provider, model },
          new AbortController(),
        ),
      )
    ).join('');

  assert.equal(await answer('claude-sonnet-5-5', 'claude'), 'from claude');
  assert.equal(await answer('gpt-6-astra', 'codex'), 'from codex');
  assert.deepEqual(
    calls.map(([provider, spaceId, , prompt, model]) => [
      provider,
      spaceId,
      prompt,
      model,
    ]),
    [
      ['claude', 'work', 'User: Why?', 'claude-sonnet-5-5'],
      ['codex', 'work', 'User: Why?', 'gpt-6-astra'],
    ],
  );
  assert.equal(
    calls[0][2],
    calls[1][2],
    'both providers get the same instructions',
  );
  assert.match(calls[0][2] as string, /Add a rate limiter/);
});

test('a background task runs on your choice, then Haiku, then Luna, and gives up with null for the local fallback', async () => {
  const tried: string[] = [];
  const askers = (fails: string[], slow = false) => {
    const asker = (provider: 'claude' | 'codex'): Asker =>
      async function* (_spaceId, _instructions, _prompt, model, abort) {
        tried.push(`${provider}:${model}`);
        if (fails.includes(provider))
          throw new Error(`${provider} is signed out`);
        if (slow)
          await new Promise((resolve) =>
            abort.signal.addEventListener('abort', resolve, { once: true }),
          );
        yield `title from ${model}`;
      };
    return { claude: asker('claude'), codex: asker('codex') };
  };
  const offers = async () => [];
  const run = (
    fails: string[],
    choice: ModelChoice = { provider: 'claude', model: 'claude-haiku-5-5' },
    slow = false,
  ) =>
    utility(
      askers(fails, slow),
      offers,
      choice,
      'work',
      'title',
      'User: fix login',
      slow ? 20 : undefined,
    );

  assert.equal((await run([]))?.text, 'title from claude-haiku-5-5');
  assert.equal(
    (await run(['claude']))?.text,
    'title from gpt-6-luna',
    'Claude signed out: Codex answers',
  );
  assert.equal(
    await run(['claude', 'codex']),
    null,
    'neither signed in: the caller keeps its truncated title',
  );
  tried.length = 0;
  assert.equal(
    (await run(['codex'], { provider: 'codex', model: 'gpt-6-sol' }))?.text,
    'title from claude-haiku-5-5',
  );
  assert.deepEqual(
    tried,
    ['codex:gpt-6-sol', 'claude:claude-haiku-5-5'],
    'your choice first, then the cheapest, Claude first',
  );
  assert.equal(
    await run([], undefined, true),
    null,
    'past the deadline: null, not a half answer',
  );
  const unlisted = await utility(
    askers([]),
    async (p) => (p === 'claude' ? ['claude-opus-5-5'] : ['gpt-6-luna']),
    { provider: 'claude', model: 'claude-haiku-5-5' },
    'work',
    'title',
    'x',
  );
  assert.equal(
    unlisted?.text,
    'title from gpt-6-luna',
    'a model the account does not offer is skipped, never swapped for its pricier default',
  );
});

test('saved side chat choices read as provider model ids', () => {
  const migrated = migrateSettings({
    concurrency: 4,
    sideChatModel: 'claude-opus-5-5',
  });
  assert.deepEqual(migrated, {
    concurrency: 4,
    sideChatModel: { provider: 'claude', model: 'claude-opus-5-5' },
  });
  assert.deepEqual(sideChatChoice(migrated.sideChatModel!), {
    provider: 'claude',
    model: 'claude-opus-5-5',
  });
  assert.deepEqual(
    sideChatChoice({ provider: 'claude', model: 'sonnet-5.5' }),
    { provider: 'claude', model: 'claude-sonnet-5-5' },
    'an old catalog id reads as the real one',
  );
  assert.deepEqual(
    migrateSettings({ sideChatModel: { provider: 'codex', model: 'gpt-5.5' } }),
    { sideChatModel: { provider: 'codex', model: 'gpt-5.5' } },
  );
});

// Array.fromAsync is past the TS lib target.
async function collect<T>(items: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}
