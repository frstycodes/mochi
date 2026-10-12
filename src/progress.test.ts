import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Step, Thread } from './model.ts';
import { boardColumns, progressAt, similarity, statusAt, timeAgo } from './progress.ts';

function step(id: string, rest: Partial<Step> = {}): Step {
  return { id, title: id, size: 1, status: 'ready', progress: 0, footprint: [], addedAt: 0, addedBy: 'you', revision: 1, ...rest };
}

const thread = {
  startedAt: 0,
  steps: [
    step('a', { status: 'done', startedAt: 0, doneAt: 10, size: 2 }),
    step('b', { status: 'running', startedAt: 10, progress: 0.5, size: 2 }),
    step('c', { status: 'dropped', droppedAt: 5 }),
    step('d', { addedAt: 20, size: 1 }),
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

test('progress weights by size, ignores dropped, grows scope over time', () => {
  assert.deepEqual(progressAt(thread, 15, false), { scope: 4, done: 2, partial: 0, pct: 0.5 });
  const live = progressAt(thread, 30, true);
  assert.equal(live.scope, 5);
  assert.equal(live.pct, (2 + 1) / 5);
});

test('shared steps align to one column and push later stations right', () => {
  const lineA = [step('a1'), step('a2', { sharedKey: 'redis' }), step('a3')];
  const lineB = [step('b1'), step('b2'), step('b3'), step('b4', { sharedKey: 'redis' })];
  const cols = boardColumns([lineA, lineB]);
  assert.equal(cols.get('a2'), 3);
  assert.equal(cols.get('b4'), 3);
  assert.equal(cols.get('a3'), 4);
});

test('similarity matches near-identical step titles only', () => {
  assert.ok(similarity('Add Redis client', 'Redis client + connection pool') >= 0.6);
  assert.ok(similarity('Add Redis client', 'Export CSV') < 0.3);
});

test('summary counts tools by verb and sums diffs from edits', async () => {
  const { summarize } = await import('./summary.ts');
  const s = summarize([
    { at: 1, who: 'codex', kind: 'tool', text: 'Read packages/db/schema/usage.ts' },
    { at: 2, who: 'codex', kind: 'tool', text: 'Edit apps/web/usage.tsx  +120 −4' },
    { at: 3, who: 'codex', kind: 'tool', text: 'Edit apps/web/usage.tsx  +8 −2' },
    { at: 4, who: 'codex', kind: 'tool', text: 'Run pnpm test' },
    { at: 5, who: 'you', kind: 'message', text: 'Edit nothing +99 −99' },
  ]);
  assert.deepEqual(s.tools, [
    { verb: 'Read', count: 1 },
    { verb: 'Edit', count: 2 },
    { verb: 'Run', count: 1 },
  ]);
  assert.equal(s.added, 128);
  assert.equal(s.removed, 6);
  assert.deepEqual(s.files, [{ path: 'apps/web/usage.tsx', added: 128, removed: 6 }]);
});

test('parseTool splits verb, target and an optional trailing diff', async () => {
  const { parseTool } = await import('./summary.ts');
  assert.deepEqual(parseTool('Edit apps/web/usage.tsx  +120 −4'), { verb: 'Edit', target: 'apps/web/usage.tsx', added: 120, removed: 4 });
  assert.deepEqual(parseTool('Run pnpm --filter api test usage'), { verb: 'Run', target: 'pnpm --filter api test usage' });
  assert.deepEqual(parseTool('git status'), { verb: 'Run', target: 'git status' });
});

test('timeAgo reads like a person would say it', () => {
  assert.equal(timeAgo(0), 'just now');
  assert.equal(timeAgo(1), '1 minute ago');
  assert.equal(timeAgo(45), '45 minutes ago');
  assert.equal(timeAgo(90), '2 hours ago');
  assert.equal(timeAgo(26 * 60), 'yesterday');
});
