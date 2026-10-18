import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry, Space, Thread } from './model.ts';
import { summarize } from './summary.ts';
import { summarySections } from './summarySections.ts';

const space = { id: 's', name: 'Personal' } as Space;
const thread = (patch: Partial<Thread>) =>
  ({ id: 't', spaceId: 's', status: 'running', activity: [], sources: [], prs: [], steps: [], revisions: [], startedAt: 0, ...patch }) as Thread;
const tool = (text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ at: 1, who: 'claude', kind: 'tool', text, ...extra });

const headers = (t: Thread) =>
  summarySections({ thread: t, summary: summarize(t.activity), threads: [t], space }).map((s) => [s.title, s.detail].filter(Boolean).join(' · '));

test('a new thread with nothing done shows no sections', () => {
  assert.deepEqual(headers(thread({})), []);
});

test('a busy thread lists what it used first and its session last', () => {
  const busy = thread({
    activity: [
      tool('Read a.ts'),
      tool('Run pnpm test'),
      tool('Edit a.ts  +3 −1'),
      tool('Skill', { skill: 'ui' }),
      tool('Mcp', { mcp: { server: 'figma', tool: 'get' } }),
    ],
    sources: [{ kind: 'link', label: 'https://x.dev' }],
    session: { provider: 'claude', usage: { input: 180_000, output: 2_000, costUsd: 0.42 } },
    agent: { model: 'opus' },
  } as Partial<Thread>);
  assert.deepEqual(headers(busy), ['Skills used · 1', 'Tools called · 4', 'Sources · 1', 'Thread usage', 'Personal usage', 'Session']);
});

test('pull requests stay in the base panel, never a section', () => {
  assert.deepEqual(headers(thread({ prs: [{ number: 1, state: 'merged', title: 'a' }] })), []);
});

test('a settled thread leads with its outcome', () => {
  const settled = thread({ status: 'settled', settledAt: 38, steps: [{ status: 'done' }] as Thread['steps'] });
  assert.deepEqual(headers(settled), ['Outcome']);
});
