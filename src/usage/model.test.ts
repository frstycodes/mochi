import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry, Thread } from '../model.ts';
import { cost, planUsage, threadUsage, WINDOW_MINUTES } from './model.ts';

const thread = (activity: ActivityEntry[], providers: Thread['providers'] = ['claude']) => ({ id: 't', spaceId: 'x', providers, activity }) as Thread;
const tool = (at: number, who: ActivityEntry['who'] = 'claude'): ActivityEntry => ({ at, who, kind: 'tool', text: 'Read a.ts' });

test('cost is per million tokens for input and output', () => {
  assert.equal(cost({ input: 1_000_000, output: 0 }, 'opus-5.5'), 5);
  assert.equal(cost({ input: 2_000_000, output: 1_000_000 }, 'gpt-5.5-codex'), 12.5);
});

test('thread usage counts agent entries only and prices by the provider default model', () => {
  const you: ActivityEntry = { at: 1, who: 'you', kind: 'message', text: 'hi' };
  const think: ActivityEntry = { at: 2, who: 'claude', kind: 'reasoning', text: '', seconds: 10 };
  const u = threadUsage(thread([tool(1), you, think]));
  assert.deepEqual({ input: u.input, output: u.output }, { input: 6_000, output: 800 });
  assert.equal(u.costUsd, cost(u, 'opus-5.5'));
});

test('plan usage rolls off outside the window and warns before running dry', () => {
  const now = 1000;
  const old = tool(now - WINDOW_MINUTES - 1);
  const idle = planUsage([thread([old])], 'claude', 'Team', now);
  assert.equal(idle.used, 0);
  assert.equal(idle.minutesLeft, null);
  assert.equal(idle.isWarning, false);

  const busy = planUsage([thread(Array.from({ length: 50 }, (_, i) => tool(now - (i % 10))))], 'claude', 'Team', now);
  assert.equal(busy.used, 50 * 6_350);
  assert.ok(busy.minutesLeft !== null && busy.minutesLeft < 45);
  assert.equal(busy.isWarning, true);
  assert.equal(planUsage([thread([tool(now, 'codex')])], 'claude', 'Team', now).used, 0);
});
