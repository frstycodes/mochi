import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry } from '../model.ts';
import { chatRows, finalReplies, liveWorkIndex } from './rows.ts';

const e = (kind: ActivityEntry['kind'], who: ActivityEntry['who'], text: string): ActivityEntry => ({ at: 0, who, kind, text });
const shape = (activity: ActivityEntry[]) => chatRows(activity).map((r) => (r.kind === 'work' ? `work(${r.entries.map((x) => x.text).join(', ')})` : r.kind === 'review' ? 'review' : r.entry.text));

test('work groups interleave with prose: tools, message, tools, message, each group in transcript order', () => {
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
      'work(Search EX271UZ review, Waiting on you: Search the web, Approved: Search the web, Search EX271UZ rtings)',
      'Two reviews so far.',
      'work(Fetch https://rtings.com/x)',
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

test('a turn of tools, prose, tools, prose, tools makes three groups in place', () => {
  assert.deepEqual(
    shape([
      e('message', 'you', 'fix CI'),
      e('tool', 'claude', 'Run gh run view 1'),
      e('tool', 'claude', 'Read ci.yml'),
      e('message', 'claude', 'Found the failing step.'),
      e('tool', 'claude', 'Edit ci.yml  +2 −1'),
      e('reasoning', 'claude', '…'),
      e('tool', 'claude', 'Run pnpm test'),
      e('message', 'claude', 'Tests pass.'),
      e('tool', 'claude', 'Run git push'),
    ]),
    ['fix CI', 'work(Run gh run view 1, Read ci.yml)', 'Found the failing step.', 'work(Edit ci.yml  +2 −1, …, Run pnpm test)', 'Tests pass.', 'work(Run git push)'],
  );
});

test('the live work row is the newest one, until anyone speaks after it', () => {
  assert.equal(liveWorkIndex(chatRows([e('message', 'you', 'go'), e('tool', 'claude', 'Run a')])), 1);
  assert.equal(liveWorkIndex(chatRows([e('message', 'you', 'go'), e('tool', 'claude', 'Run a'), e('message', 'claude', 'ok')])), -1);
  assert.equal(liveWorkIndex(chatRows([e('message', 'you', 'go'), e('tool', 'claude', 'Run a'), e('message', 'claude', 'ok'), e('tool', 'claude', 'Run b')])), 3);
});

test('a subagent is its own row where it started, and the turn goes on in a new accordion after it', () => {
  const agent: ActivityEntry = { ...e('subagent', 'claude', 'Load test'), subagentId: 'toolu_1' };
  assert.deepEqual(shape([e('message', 'you', 'go'), e('tool', 'claude', 'Read a.ts'), agent, e('tool', 'claude', 'Edit a.ts')]), ['go', 'work(Read a.ts)', 'Load test', 'work(Edit a.ts)']);
  assert.deepEqual(chatRows([agent]).map((r) => r.kind), ['subagent']);
});

test('message actions go on the agent\'s last reply of each turn, and on the newest turn only once it is idle', () => {
  const activity = [
    e('message', 'you', 'fix it'),
    e('message', 'claude', 'Looking.'),
    e('tool', 'claude', 'Read a.ts'),
    e('message', 'claude', 'Fixed.'),
    e('event', 'harness', 'Goal v2'),
    e('message', 'you', 'thanks, now tests'),
    e('message', 'claude', 'Running them.'),
  ];
  const rows = chatRows(activity);
  const text = (set: Set<number>) => [...set].map((i) => (rows[i].kind === 'message' ? rows[i].entry.text : '?'));
  assert.deepEqual(text(finalReplies(rows, true)), ['Fixed.'], 'mid-turn replies and the working turn get none');
  assert.deepEqual(text(finalReplies(rows, false)), ['Fixed.', 'Running them.']);
});
