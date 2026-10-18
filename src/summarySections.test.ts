import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry, Space, Thread } from './model.ts';
import { summarize } from './summary.ts';
import { openSectionIds, summarySections } from './summarySections.ts';

const space = { id: 's', name: 'Personal' } as Space;
const thread = (patch: Partial<Thread>) =>
  ({ id: 't', spaceId: 's', status: 'running', activity: [], sources: [], prs: [], steps: [], revisions: [], startedAt: 0, ...patch }) as Thread;
const tool = (text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ at: 1, who: 'claude', kind: 'tool', text, ...extra });

const headers = (t: Thread) =>
  summarySections({ thread: t, summary: summarize(t.activity), threads: [t], space }).map((s) => [s.title, s.detail].filter(Boolean).join(' · '));

test('a new thread with nothing done shows no sections', () => {
  assert.deepEqual(headers(thread({})), []);
});

test('a busy thread says something in every closed header, in reading order', () => {
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
  assert.deepEqual(headers(busy), [
    'Sources · 1',
    'Skills used · 1',
    'Tools called · 4',
    'Session · opus',
    'Thread usage · 182K tokens · $0.42',
    'Personal usage · 182K tokens · $0.42',
  ]);
  const sections = summarySections({ thread: busy, summary: summarize(busy.activity), threads: [busy], space });
  assert.deepEqual(openSectionIds(sections, { sources: true, session: true }, false), ['sources', 'session']);
});

test('skills and tools are always shown, never opened or closed', () => {
  const t = thread({ activity: [tool('Read a.ts'), tool('Skill', { skill: 'ui' })] });
  const sections = summarySections({ thread: t, summary: summarize(t.activity), threads: [t], space });
  assert.deepEqual(sections.map((s) => s.id).slice(0, 2), ['skills', 'tools']);
  const remembered = Object.fromEntries(sections.map((s) => [s.id, true]));
  assert.deepEqual(openSectionIds(sections, remembered, false), ['usage', 'space']);
});

test('pull requests stay in the base panel, never a section', () => {
  assert.deepEqual(headers(thread({ prs: [{ number: 1, state: 'merged', title: 'a' }] })), []);
});

test('a settled thread leads with its outcome, open until you close it', () => {
  const settled = thread({
    status: 'settled',
    settledAt: 38,
    criteria: [{ id: 'a', text: 'a', command: 'pnpm test', check: { status: 'passed' } }, { id: 'b', text: 'b', claim: { evidence: 'said so' } }] as Thread['criteria'],
    revisions: [{ n: 1 }] as Thread['revisions'],
  });
  const sections = summarySections({ thread: settled, summary: summarize([]), threads: [settled], space });
  assert.deepEqual(headers(settled), ['Outcome · 38m · 1 of 2 verified']);
  assert.deepEqual(openSectionIds(sections, {}, true), ['outcome']);
  assert.deepEqual(openSectionIds(sections, { outcome: false }, true), []);
  assert.deepEqual(openSectionIds(sections, {}, false), []);
});
