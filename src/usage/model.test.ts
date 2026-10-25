import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry, Thread } from '../model.ts';
import { spaceUsage, threadUsage } from './model.ts';

const thread = (
  activity: ActivityEntry[],
  providers: Thread['providers'] = ['claude'],
) => ({ id: 't', spaceId: 'x', providers, activity }) as Thread;
const tool = (
  at: number,
  who: ActivityEntry['who'] = 'claude',
): ActivityEntry => ({ at, who, kind: 'tool', text: 'Read a.ts' });

test('thread usage counts agent entries only, with no cost unless the harness reported one', () => {
  const you: ActivityEntry = { at: 1, who: 'you', kind: 'message', text: 'hi' };
  const think: ActivityEntry = {
    at: 2,
    who: 'claude',
    kind: 'reasoning',
    text: '',
    seconds: 10,
  };
  const u = threadUsage(thread([tool(1), you, think]));
  assert.deepEqual(
    { input: u.input, output: u.output },
    { input: 6_000, output: 800 },
  );
  assert.equal(u.costUsd, null);
});

test('reported cost is passed through; a space sums the threads that reported one and stays null when none did', () => {
  const claude = {
    ...thread([]),
    session: {
      provider: 'claude',
      id: 's',
      usage: { input: 10, output: 2, costUsd: 0.5 },
    },
  } as Thread;
  const codex = {
    ...thread([], ['codex']),
    id: 'c',
    session: { provider: 'codex', id: 's2', usage: { input: 30, output: 4 } },
  } as Thread;
  assert.deepEqual(threadUsage(claude), { input: 10, output: 2, costUsd: 0.5 });
  assert.deepEqual(threadUsage(codex), { input: 30, output: 4, costUsd: null });
  const space = { id: 'x', plans: {} } as Parameters<typeof spaceUsage>[1];
  assert.equal(spaceUsage([claude, codex], space).costUsd, 0.5);
  assert.equal(spaceUsage([codex], space).costUsd, null);
});
