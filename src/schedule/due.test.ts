process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Trigger } from '../host/types/schedule.ts';
import { afterLaunch, branchMatches, cronDecision, prEvents, summaryLine, type PrSnapshot } from './due.ts';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const idle = { isRunning: false, isBusy: false };

function trigger(over: Partial<Trigger> = {}): Trigger {
  return {
    threadId: 't1',
    name: 'Nightly dependency check',
    prompt: 'Check dependencies',
    when: { kind: 'cron', cron: '0 2 * * *' },
    missed: 'run-once',
    start: { provider: 'claude', spaceId: 'work', cwd: '/repo' },
    isPaused: false,
    createdAt: 0,
    checkedAt: local(2026, 10, 12, 1),
    runs: [],
    ...over,
  };
}

test('a cron trigger runs once it is due, not before', () => {
  assert.equal(cronDecision(trigger(), local(2026, 10, 12, 1, 59), idle).kind, 'idle');
  assert.deepEqual(cronDecision(trigger(), local(2026, 10, 12, 2), idle), { kind: 'run', reason: 'Every day at 02:00' });
  assert.equal(cronDecision(trigger({ isPaused: true }), local(2026, 10, 12, 3), idle).kind, 'idle');
});

test('never two runs at once: due during its own run skips, a busy thread waits', () => {
  assert.equal(cronDecision(trigger(), local(2026, 10, 12, 2), { isRunning: true, isBusy: true }).kind, 'skip');
  assert.equal(cronDecision(trigger(), local(2026, 10, 12, 2), { isRunning: false, isBusy: true }).kind, 'wait');
});

test('missed runs while quit: several missed nights run once, or are skipped', () => {
  // Quit for three nights.
  const now = local(2026, 10, 15, 9);
  const once = afterLaunch(trigger(), now);
  assert.equal(cronDecision(once, now, idle).kind, 'run');
  // After that run the scheduler sets checkedAt = now, so nothing more is due until tonight.
  assert.equal(cronDecision({ ...once, checkedAt: now }, now + 60_000, idle).kind, 'idle');
  const skipped = afterLaunch(trigger({ missed: 'skip' }), now);
  assert.equal(skipped.checkedAt, now);
  assert.equal(cronDecision(skipped, now, idle).kind, 'idle');
  assert.equal(cronDecision(skipped, local(2026, 10, 16, 2), idle).kind, 'run');
});

const pr = (number: number, over: Partial<PrSnapshot> = {}): PrSnapshot => ({ number, title: `PR ${number}`, headRefName: `feat/${number}`, headRefOid: 'a1', labels: [], ...over });

test('PR triggers: the first poll is a baseline, then each new event fires once', () => {
  const t = trigger({ when: { kind: 'pr', event: 'opened' } });
  assert.deepEqual(prEvents(t, [pr(1)]), { fires: [], baseline: ['opened:1'] });
  const seen = { ...t, seen: ['opened:1'] };
  assert.deepEqual(prEvents(seen, [pr(1), pr(3), pr(2)]).fires.map((f) => f.key), ['opened:2', 'opened:3']);
});

test('PR triggers filter by branch pattern and label; CI fires per commit', () => {
  const ci = trigger({ when: { kind: 'pr', event: 'ci-failed', branch: 'feat/*', label: 'deps' } as const, seen: [] });
  const failing = { statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }], labels: [{ name: 'deps' }] };
  const fires = prEvents(ci, [pr(1, failing), pr(2, { ...failing, labels: [] }), pr(3, { ...failing, headRefName: 'main' }), pr(4, { labels: [{ name: 'deps' }] })]).fires;
  assert.deepEqual(fires.map((f) => f.key), ['ci:1:a1']);
  assert.equal(fires[0].reason, 'PR #1 CI failed');
  assert.deepEqual(prEvents({ ...ci, seen: ['ci:1:a1'] }, [pr(1, { ...failing, headRefOid: 'b2' })]).fires.map((f) => f.key), ['ci:1:b2']);
});

test('branch patterns and summaries', () => {
  assert.ok(branchMatches('release/*', 'release/1.2'));
  assert.ok(!branchMatches('release/*', 'hotfix/release/1'));
  assert.ok(branchMatches('a.b', 'a.b') && !branchMatches('a.b', 'axb'));
  assert.equal(summaryLine('\n## **2 findings**\n- lodash is outdated'), '2 findings');
});
