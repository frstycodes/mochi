import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { UsageReport } from '../host/types/usage.ts';
import { OTHER_FOLDERS, rangeStart, usageView } from './report.ts';

const NOW = new Date('2026-10-17T15:00:00').getTime();
// Opus 5.5 per bucket: output 1M × $20 + reads 10M × $0.20 + 5-minute writes 1M × $5 = $27; uncached (11M in × $4) + $20 = $64.
const bucket = (day: string, model: string, root = '/a', isPriced = true) => ({
  day, harness: 'claude' as const, model, root, input: 0, output: 1_000_000, cacheRead: 10_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 0,
  cost: isPriced ? { input: 0, output: 20, cacheRead: 2, cacheWrite: 5 } : null,
  uncached: isPriced ? 64 : null,
});
const report: UsageReport = {
  tokens: [bucket('2026-10-12', 'claude-opus-5-5'), bucket('2026-10-13', 'claude-opus-5-5', '/b'), bucket('2026-10-13', 'mystery-model', '/a', false)],
  sessions: [],
  commits: [
    { repo: '/a', at: new Date('2026-10-12T01:30:00').getTime(), added: 100, removed: 5, isMerge: false },
    { repo: '/a', at: new Date('2026-10-12T02:00:00').getTime(), added: 0, removed: 0, isMerge: true },
  ],
  prs: [{ repo: '/a', number: 1, state: 'MERGED', createdAt: 0, mergedAt: new Date('2026-10-12T09:00:00').getTime() }],
  errors: [],
};
const projectOf = new Map([['/a', 'p1'], ['/b', 'p2']]);

test('a range starts at local midnight and includes today', () => {
  assert.equal(new Date(rangeStart('7d', NOW)!).toDateString(), new Date('2026-10-11T00:00:00').toDateString());
  assert.equal(rangeStart('all', NOW), null);
});

test('spend, uncached spend, merges and unpriced models add up per project', () => {
  const all = usageView(report, { range: '7d', now: NOW, projectOf, target: { kind: 'projects' } });
  assert.equal(all.spend.total, 54);
  assert.equal(all.spend.uncached, 128);
  assert.deepEqual(all.unpriced, ['mystery-model']);
  assert.deepEqual([all.commits.count, all.commits.merges, all.prs.merged], [1, 1, 1]);
  assert.equal(all.heatmap[0][1], 1, 'Monday 1am lands on the first row');
  assert.equal(all.series.length, 7);

  const one = usageView(report, { range: '7d', now: NOW, projectOf, target: { kind: 'project', id: 'p2' } });
  assert.deepEqual([one.spend.total, one.commits.count], [27, 0]);

  // A session outside every project counts only everywhere, on its own row.
  const outside = { ...report, tokens: [...report.tokens, bucket('2026-10-14', 'claude-opus-5-5', '/tmp/scratch')] };
  assert.equal(usageView(outside, { range: '7d', now: NOW, projectOf, target: { kind: 'projects' } }).spend.total, 54);
  const everywhere = usageView(outside, { range: '7d', now: NOW, projectOf, target: { kind: 'everywhere' } });
  assert.equal(everywhere.spend.total, 81);
  assert.ok(everywhere.projects.some((r) => r.projectId === OTHER_FOLDERS && r.cost === 27));
});
