import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry, PullRequest, Space, Thread } from './model.ts';
import { summarize } from './summary.ts';
import { openSectionIds, summarySections } from './summarySections.ts';

const space = { id: 's', name: 'Personal' } as Space;
const thread = (patch: Partial<Thread>) =>
  ({ id: 't', spaceId: 's', status: 'running', activity: [], sources: [], prs: [], steps: [], revisions: [], startedAt: 0, ...patch }) as Thread;
const tool = (text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ at: 1, who: 'claude', kind: 'tool', text, ...extra });
const pr = (number: number, state: PullRequest['state']): PullRequest => ({ number, state, title: `PR ${number}` });

const headers = (t: Thread, prs = t.prs) =>
  summarySections({ thread: t, summary: summarize(t.activity), prs, threads: [t], space }).map((s) => [s.title, s.detail].filter(Boolean).join(' · '));

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
});

test('pull requests get a section only for those the chips leave out', () => {
  assert.deepEqual(headers(thread({}), [pr(1, 'open'), pr(2, 'draft')]), []);
  assert.deepEqual(headers(thread({}), [pr(1, 'open'), pr(2, 'merged')]), ['Pull requests · 2']);
});

test('a settled thread leads with its outcome, open until you close it', () => {
  const settled = thread({
    status: 'settled',
    settledAt: 38,
    steps: [{ status: 'done' }, { status: 'dropped' }] as Thread['steps'],
    revisions: [{ n: 1 }] as Thread['revisions'],
  });
  const sections = summarySections({ thread: settled, summary: summarize([]), prs: [], threads: [settled], space });
  assert.deepEqual(headers(settled), ['Outcome · 38m · 1 step done']);
  assert.deepEqual(openSectionIds(sections, {}, true), ['outcome']);
  assert.deepEqual(openSectionIds(sections, { outcome: false }, true), []);
  assert.deepEqual(openSectionIds(sections, {}, false), []);
});
