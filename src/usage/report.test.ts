import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UsageReport } from '../host/types/usage.ts';
import { priceOf } from './pricing.ts';
import { rangeStart, usageView } from './report.ts';

const NOW = new Date('2026-10-17T15:00:00').getTime();
const bucket = (day: string, model: string, root = '/a') => ({ day, harness: 'claude' as const, model, root, input: 0, output: 1_000_000, cacheRead: 10_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 0 });
const report: UsageReport = {
  tokens: [bucket('2026-10-12', 'claude-opus-5-5'), bucket('2026-10-13', 'claude-opus-5-5', '/b'), bucket('2026-10-13', 'mystery-model')],
  sessions: [],
  commits: [
    { repo: '/a', at: new Date('2026-10-12T01:30:00').getTime(), added: 100, removed: 5, isMerge: false },
    { repo: '/a', at: new Date('2026-10-12T02:00:00').getTime(), added: 0, removed: 0, isMerge: true },
  ],
  prs: [{ repo: '/a', number: 1, state: 'MERGED', createdAt: 0, mergedAt: new Date('2026-10-12T09:00:00').getTime() }],
  errors: [],
};
const projectOf = new Map([['/a', 'p1'], ['/b', 'p2']]);

test('the longest price prefix wins, and an unknown model has none', () => {
  assert.equal(priceOf('claude-opus-5-5')?.input, 4);
  assert.equal(priceOf('claude-opus-5-20260101')?.input, 5);
  assert.equal(priceOf('mystery-model'), null);
});

test('a range starts at local midnight and includes today', () => {
  assert.equal(new Date(rangeStart('7d', NOW)!).toDateString(), new Date('2026-10-11T00:00:00').toDateString());
  assert.equal(rangeStart('all', NOW), null);
});

test('spend, uncached spend, merges and unpriced models add up per project', () => {
  const all = usageView(report, { range: '7d', now: NOW, projectOf, projectId: null });
  // Opus 5.5 per bucket: output 1M×$20 + reads 10M×$0.20 + 5-min writes 1M×$5 = $27.
  assert.equal(all.spend.total, 54);
  assert.equal(all.spend.uncached, 2 * (11 * 4 + 20));
  assert.deepEqual(all.unpriced, ['mystery-model']);
  assert.deepEqual([all.commits.count, all.commits.merges, all.prs.merged], [1, 1, 1]);
  assert.equal(all.heatmap[0][1], 1, 'Monday 1am lands on the first row');
  assert.equal(all.series.length, 7);

  const one = usageView(report, { range: '7d', now: NOW, projectOf, projectId: 'p2' });
  assert.deepEqual([one.spend.total, one.commits.count], [27, 0]);
});
