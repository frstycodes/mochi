import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import { settledThreads } from '../reorder.ts';
import {
  dueForDelete,
  groupByDate,
  matchesQuery,
  settledMsOf,
} from './settled.ts';

const DAY = 24 * 60 * 60 * 1000;
// Local noon, so a day either side stays on its own calendar day in any time zone.
const NOW = new Date(2026, 9, 26, 12).getTime();

const thread = (id: string, fields: Partial<Thread> = {}) =>
  ({
    id,
    title: id,
    status: 'settled',
    startedAt: 0,
    activity: [],
    prs: [],
    ...fields,
  }) as unknown as Thread;

test('a settled time is the stamped one, else the last stamped activity, else unknown', () => {
  assert.equal(settledMsOf(thread('a', { settledMs: 5 })), 5);
  assert.equal(
    settledMsOf(
      thread('b', {
        activity: [{ ms: 3 }, { ms: 4 }, {}] as Thread['activity'],
      }),
    ),
    4,
  );
  assert.equal(settledMsOf(thread('c')), undefined);
});

test('settled threads sort newest first, unknown times last, active ones left out', () => {
  const threads = [
    thread('old', { settledMs: NOW - 3 * DAY }),
    thread('unknown'),
    thread('live', { status: 'running', settledMs: NOW }),
    thread('new', { settledMs: NOW - DAY }),
  ];
  assert.deepEqual(
    settledThreads(threads).map((t) => t.id),
    ['new', 'old', 'unknown'],
  );
});

test('every query word must match the title, branch or a PR', () => {
  const t = thread('Fix login', {
    repo: { branch: 'mochi/auth' } as Thread['repo'],
    prs: [{ number: 42, state: 'merged', title: 'Cookie fix' }],
  });
  assert.ok(matchesQuery(t, ''));
  assert.ok(matchesQuery(t, 'LOGIN fix'));
  assert.ok(matchesQuery(t, 'mochi/auth #42'));
  assert.ok(matchesQuery(t, 'cookie'));
  assert.equal(matchesQuery(t, 'login payments'), false);
});

test('groups run Today, Yesterday, 7 and 30 days, months, then Earlier', () => {
  const at = (id: string, ms?: number) =>
    thread(id, ms === undefined ? {} : { settledMs: ms });
  const groups = groupByDate(
    settledThreads([
      at('today', NOW - 60_000),
      at('yesterday', NOW - DAY),
      at('week', NOW - 4 * DAY),
      at('month', NOW - 20 * DAY),
      at('august', new Date(2026, 7, 3).getTime()),
      at('august2', new Date(2026, 7, 1).getTime()),
      at('lastYear', new Date(2025, 2, 9).getTime()),
      at('unknown'),
    ]),
    NOW,
  );
  const august = new Date(2026, 7, 3).toLocaleDateString(undefined, {
    month: 'long',
  });
  const march2025 = new Date(2025, 2, 9).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  assert.deepEqual(
    groups.map((g) => [g.label, g.threads.map((t) => t.id)]),
    [
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Previous 30 days', ['month']],
      [august, ['august', 'august2']],
      [march2025, ['lastYear']],
      ['Earlier', ['unknown']],
    ],
  );
});

test('retention deletes only threads settled past the cutoff, never pinned, open-PR or unknown ones', () => {
  const old = NOW - 31 * DAY;
  const threads = [
    thread('due', { settledMs: old }),
    thread('recent', { settledMs: NOW - 29 * DAY }),
    thread('pinned', { settledMs: old, pinOrder: 1 }),
    thread('openPr', {
      settledMs: old,
      prs: [{ number: 1, state: 'open', title: 'x' }],
    }),
    thread('mergedPr', {
      settledMs: old,
      prs: [{ number: 2, state: 'merged', title: 'y' }],
    }),
    thread('unknown'),
    thread('active', { status: 'running', settledMs: old }),
  ];
  assert.deepEqual(
    dueForDelete(threads, NOW, 30).map((t) => t.id),
    ['due', 'mergedPr'],
  );
});
