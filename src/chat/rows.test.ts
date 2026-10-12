import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry } from '../model.ts';
import { chatRows, liveWorkIndex } from './rows.ts';

const e = (kind: ActivityEntry['kind'], who: ActivityEntry['who'], text: string): ActivityEntry => ({ at: 0, who, kind, text });
const shape = (activity: ActivityEntry[]) => chatRows(activity).map((r) => (r.kind === 'work' ? `work(${r.entries.map((x) => x.text).join(', ')})` : r.kind === 'review' ? 'review' : r.entry.text));

test('a turn folds every tool call, approval and harness event into one work row; prose stays outside', () => {
  assert.deepEqual(
    shape([
      e('message', 'you', 'find a monitor'),
      e('event', 'harness', 'Sent off-goal · not counted'),
      e('tool', 'claude', 'Search EX271UZ review'),
      e('event', 'harness', 'Waiting on you: Search the web'),
      e('event', 'you', 'Approved: Search the web'),
      e('tool', 'claude', 'Search EX271UZ rtings'),
      e('message', 'claude', 'Two reviews so far.'),
      e('tool', 'claude', 'Fetch https://rtings.com/x'),
      e('message', 'claude', 'Done.'),
      e('event', 'harness', 'Scheduled run: nightly'),
      e('message', 'you', 'thanks'),
      e('tool', 'claude', 'Run pnpm test'),
    ]),
    [
      'find a monitor',
      'Sent off-goal · not counted',
      'work(Search EX271UZ review, Waiting on you: Search the web, Approved: Search the web, Search EX271UZ rtings, Fetch https://rtings.com/x)',
      'Two reviews so far.',
      'Done.',
      'Scheduled run: nightly',
      'thanks',
      'work(Run pnpm test)',
    ],
  );
});

test("Mochi's approval widgets stay their own row mid-turn; the turn's later work starts a new accordion", () => {
  const card: ActivityEntry = { ...e('event', 'harness', 'Delete thread'), card: { id: 'c1', isOpen: true } };
  assert.deepEqual(shape([e('message', 'you', 'clean up'), e('tool', 'claude', 'Read a.ts'), card, e('tool', 'claude', 'Run pnpm test')]), [
    'clean up',
    'work(Read a.ts)',
    'Delete thread',
    'work(Run pnpm test)',
  ]);
});

test('the live work row is the newest one, unless you spoke after it', () => {
  const rows = chatRows([e('message', 'you', 'go'), e('tool', 'claude', 'Run a'), e('message', 'claude', 'ok')]);
  assert.equal(liveWorkIndex(rows), 1);
  assert.equal(liveWorkIndex(chatRows([e('message', 'you', 'go'), e('tool', 'claude', 'Run a'), e('message', 'you', 'more')])), -1);
});

test('a subagent is its own row where it started, and the turn goes on in a new accordion after it', () => {
  const agent: ActivityEntry = { ...e('subagent', 'claude', 'Load test'), subagentId: 'toolu_1' };
  assert.deepEqual(shape([e('message', 'you', 'go'), e('tool', 'claude', 'Read a.ts'), agent, e('tool', 'claude', 'Edit a.ts')]), ['go', 'work(Read a.ts)', 'Load test', 'work(Edit a.ts)']);
  assert.deepEqual(chatRows([agent]).map((r) => r.kind), ['subagent']);
});
