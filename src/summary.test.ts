import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry } from './model.ts';
import { describeApproval, eventLine, isApprovalChatter, turnDuration, turnSummary } from './summary.ts';

const tool = (text: string, at = 0, ms?: number): ActivityEntry => ({ at, who: 'claude', kind: 'tool', text, ms });

test('a finished turn reads as counts by importance, plural-aware, with its duration', () => {
  const entries = [
    tool('Search a', 0, 0),
    tool('Search b'),
    tool('Search c'),
    tool('Search d'),
    tool('Run pnpm test'),
    tool('Edit src/a.ts  +3 −1'),
    tool('Edit src/a.ts  +1 −0'),
    tool('Edit src/b.ts  +2 −2'),
    { at: 1, who: 'harness', kind: 'event', text: 'Waiting on you: search the web', ms: 72_000 } satisfies ActivityEntry,
    { at: 1, who: 'you', kind: 'event', text: 'Approved: search the web' } satisfies ActivityEntry,
  ];
  assert.equal(turnSummary(entries), 'Edited 2 files, ran 1 command, searched 4 times · 1m 12s');
  assert.equal(turnSummary([tool('Search a', 0), tool('Fetch https://x.dev', 3)]), 'Searched once, read 1 page · 3m', 'minutes without wall-clock stamps');
  assert.equal(turnSummary([{ at: 0, who: 'claude', kind: 'reasoning', text: '…' }]), 'Thought it through · 1m');
});

test('turn durations', () => {
  assert.equal(turnDuration([tool('Run a', 0, 0), tool('Run b', 0, 42_400)]), '42s');
  assert.equal(turnDuration([tool('Run a', 0, 0), tool('Run b', 0, 120_000)]), '2m');
  assert.equal(turnDuration([tool('Run a', 0), tool('Run b', 75)]), '1h 15m');
});

test('approvals read as sentences, never raw JSON', () => {
  assert.equal(describeApproval('WebSearch', { query: 'EX271UZ review', allowed_domains: ['rtings.com', 'tftcentral.co.uk', 'a', 'b', 'c', 'd', 'e'] }), 'search the web for “EX271UZ review” on rtings.com, tftcentral.co.uk +5 more');
  assert.equal(describeApproval('WebFetch', { url: 'https://www.rtings.com/monitor' }), 'read rtings.com/monitor');
  assert.equal(describeApproval('Grep', { pattern: 'x' }), undefined);
  assert.equal(eventLine('Approved: {\n  "query": "BenQ EX271UZ review video YouTube",\n  "mode": "standard"\n}'), 'Approved: search the web for “BenQ EX271UZ review video YouTube”');
  assert.equal(eventLine('Approved: Search the web for “x”'), 'Approved: search the web for “x”');
  assert.equal(eventLine('Waiting on you: WebSearch'), 'Waiting on you: WebSearch');
  assert.equal(eventLine('Goal v2: +1 step'), 'Goal v2: +1 step');
  assert.deepEqual(['Waiting on you: x', 'Approved: x', 'Denied: x', 'Goal v2: +1 step'].map(isApprovalChatter), [true, true, false, false]);
});
