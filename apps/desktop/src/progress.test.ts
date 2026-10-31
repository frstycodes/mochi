import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Step, Thread } from './model.ts';
import {
  boardColumns,
  similarity,
  statusAt,
  timeAgo,
  duration,
  formatElapsed,
} from './progress.ts';

test('the shared duration formatter preserves minute, ticking and precise command styles', () => {
  assert.deepEqual([0, 5, 60, 63].map(duration), ['0m', '5m', '1h', '1h 3m']);
  assert.equal(formatElapsed(65_000), '1m 05s');
  assert.equal(formatElapsed(1250, 'precise'), '1.3s');
  assert.equal(formatElapsed(65_000, 'precise'), '1m 5s');
});

function step(id: string, rest: Partial<Step> = {}): Step {
  return {
    id,
    title: id,
    status: 'ready',
    addedAt: 0,
    addedBy: 'you',
    ...rest,
  };
}

const thread = {
  startedAt: 0,
  steps: [
    step('a', { status: 'done', startedAt: 0, doneAt: 10 }),
    step('b', { status: 'running', startedAt: 10 }),
    step('c', { status: 'dropped', droppedAt: 5 }),
    step('d', { addedAt: 20 }),
  ],
} as Thread;

test('statusAt replays a step through time', () => {
  const a = thread.steps[0];
  assert.equal(statusAt(a, -1), null);
  assert.equal(statusAt(a, 5), 'running');
  assert.equal(statusAt(a, 10), 'done');
  assert.equal(statusAt(thread.steps[2], 4), 'ready');
  assert.equal(statusAt(thread.steps[2], 5), 'dropped');
});

test("a step sits in its own plan's column on the board", () => {
  const cols = boardColumns([[step('a1'), step('a2')], [step('b1')]]);
  assert.deepEqual([cols.get('a1'), cols.get('a2'), cols.get('b1')], [0, 1, 0]);
});

test('similarity matches near-identical step titles only', () => {
  assert.ok(
    similarity('Add Redis client', 'Redis client + connection pool') >= 0.6,
  );
  assert.ok(similarity('Add Redis client', 'Export CSV') < 0.3);
});

test("summary sums each edited file's diffs, ignoring your messages", async () => {
  const { summarize } = await import('./summary.ts');
  const s = summarize([
    {
      at: 1,
      who: 'codex',
      kind: 'tool',
      text: 'Read packages/db/schema/usage.ts',
    },
    {
      at: 2,
      who: 'codex',
      kind: 'tool',
      text: 'Edit apps/web/usage.tsx  +120 −4',
    },
    {
      at: 3,
      who: 'codex',
      kind: 'tool',
      text: 'Edit apps/web/usage.tsx  +8 −2',
    },
    { at: 4, who: 'codex', kind: 'tool', text: 'Run pnpm test' },
    { at: 5, who: 'you', kind: 'message', text: 'Edit nothing +99 −99' },
  ]);
  assert.deepEqual(s.files, [
    { path: 'apps/web/usage.tsx', added: 128, removed: 6 },
  ]);
});

test('parseTool splits verb, target and an optional trailing diff', async () => {
  const { parseTool } = await import('./summary.ts');
  assert.deepEqual(parseTool('Edit apps/web/usage.tsx  +120 −4'), {
    verb: 'Edit',
    target: 'apps/web/usage.tsx',
    added: 120,
    removed: 4,
  });
  assert.deepEqual(parseTool('Run pnpm --filter api test usage'), {
    verb: 'Run',
    target: 'pnpm --filter api test usage',
  });
  assert.deepEqual(parseTool('git status'), {
    verb: 'Run',
    target: 'git status',
  });
});

test('timeAgo reads like a person would say it', () => {
  assert.equal(timeAgo(0), 'just now');
  assert.equal(timeAgo(1), '1 minute ago');
  assert.equal(timeAgo(45), '45 minutes ago');
  assert.equal(timeAgo(90), '2 hours ago');
  assert.equal(timeAgo(26 * 60), 'yesterday');
});
