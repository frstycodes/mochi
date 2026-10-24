import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry } from '../model.ts';
import { chatRows, finalReplies, liveWorkIndex, planSummary } from './rows.ts';
import { turnChanges, type TurnChanges } from './turnChanges.ts';

const e = (kind: ActivityEntry['kind'], who: ActivityEntry['who'], text: string): ActivityEntry => ({ at: 0, who, kind, text });
const shape = (activity: ActivityEntry[], changes: TurnChanges[] = []) =>
  chatRows(activity, [], changes).map((r) => ('entries' in r ? `${r.kind}(${r.entries.map((x) => x.text).join(', ')})` : r.kind === 'review' ? 'review' : r.kind === 'changes' ? `changes(${r.turn.start})` : r.entry.text));

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
  assert.deepEqual(shape([e('message', 'you', 'go'), e('tool', 'claude', 'Read a.ts'), agent, e('tool', 'claude', 'Edit a.ts')]), ['go', 'work(Read a.ts)', 'subagent(Load test)', 'work(Edit a.ts)']);
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

test("a turn's changes card sits after its last row, before your next message; an open turn's goes last", () => {
  const activity = [
    e('message', 'you', 'add charts'),
    e('tool', 'claude', 'Edit charts.tsx  +12 −0'),
    e('message', 'claude', 'Added.'),
    e('message', 'you', 'thanks'),
    e('message', 'claude', 'Anytime.'),
    e('message', 'you', 'now tests'),
    e('tool', 'claude', 'Write charts.test.ts  +30 −0'),
    e('message', 'claude', 'Tested.'),
  ];
  assert.deepEqual(shape(activity, turnChanges(activity)), [
    'add charts',
    'work(Edit charts.tsx  +12 −0)',
    'Added.',
    'changes(0)',
    'thanks',
    'Anytime.',
    'now tests',
    'work(Write charts.test.ts  +30 −0)',
    'Tested.',
    'changes(5)',
  ]);
});

test("another thread's message is its own log row: it ends the work group before it and starts a turn like yours", () => {
  const received: ActivityEntry = { ...e('message', 'you', 'Keys rotate hourly'), from: { threadId: 't2', title: 'Crypto module' } };
  const activity = [e('message', 'you', 'sync the keys'), e('tool', 'claude', 'Run pnpm test'), e('message', 'claude', 'Waiting on crypto.'), received, e('tool', 'claude', 'Edit keys.ts'), e('message', 'claude', 'Rotated.')];
  const rows = chatRows(activity);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['message', 'work', 'message', 'thread-message', 'work', 'message'],
  );
  assert.deepEqual(rows[3], { kind: 'thread-message', key: '0-3', entry: received, index: 3 });
  assert.deepEqual([...finalReplies(rows, false)], [2, 5], 'the reply before it is final, like before your own message');
  assert.equal(liveWorkIndex(chatRows(activity.slice(0, 4))), -1, 'the group before it is no longer live');
});

test("an MCP App view gets its own row after its call's group, and the turn goes on in a new group", () => {
  const widget = { server: 'claude.ai mobbin', uri: 'ui://mobbin/search-screens.html', input: {}, result: { content: [] } };
  const rows = chatRows([e('tool', 'claude', 'Search Mobbin'), { ...e('tool', 'claude', 'Search screens'), widget }, e('tool', 'claude', 'Read a.ts'), e('message', 'claude', 'Done.')]);
  assert.deepEqual(
    rows.map((r) => (r.kind === 'work' ? `work(${r.entries.map((x) => x.text).join(', ')})` : 'entry' in r ? `${r.kind}:${r.entry.text}` : r.kind)),
    ['work(Search Mobbin, Search screens)', 'widget:Search screens', 'work(Read a.ts)', 'message:Done.'],
  );
});

test('plan and turn-report calls have their own surfaces, so they get no work-log row', () => {
  const mochi = (tool: string): ActivityEntry => ({ ...e('tool', 'claude', `Mcp mochi: ${tool}`), mcp: { server: 'mochi', tool } });
  assert.deepEqual(shape([mochi('update_plan'), e('tool', 'claude', 'Read src/a.ts'), mochi('update_plan'), e('message', 'claude', 'Done.'), mochi('report_turn')]), ['work(Read src/a.ts)', 'Done.']);
  assert.deepEqual(shape([mochi('rename_thread')]), ['work(Mcp mochi: rename_thread)'], 'other Mochi calls keep their rows');
});

test('a second opinion the agent asked for sits where its verdict reached the agent, in place of that message', () => {
  const review = { id: 'so-1', provider: 'codex' as const, afterIndex: 1, startedAt: 0, status: 'done' as const, steps: [], isAgentAsked: true };
  const label = (rows: ReturnType<typeof chatRows>) => rows.map((r) => (r.kind === 'review' ? `review(${r.review.id})` : r.kind === 'work' || r.kind === 'plan' ? r.kind : r.kind === 'changes' ? 'changes' : r.kind === 'subagent' ? 'subagent' : r.entry.text));
  const asked = [e('message', 'you', 'fix login'), e('tool', 'claude', 'Edit auth.ts'), e('message', 'claude', 'Done, checking with Codex.')];
  assert.deepEqual(label(chatRows(asked, [{ ...review, status: 'running' }])), ['fix login', 'review(so-1)', 'work', 'Done, checking with Codex.'], 'while it runs, where it started');
  const findings: ActivityEntry = { ...e('message', 'you', 'Codex reviewed the diff…'), secondOpinion: { reviewId: 'so-1', provider: 'codex' } };
  assert.deepEqual(label(chatRows([...asked, findings, e('message', 'claude', 'Fixed the empty case.')], [review])), ['fix login', 'work', 'Done, checking with Codex.', 'review(so-1)', 'Fixed the empty case.']);
});

test('subagents started back to back share one row; anything between them starts a new one', () => {
  const agent = (id: string): ActivityEntry => ({ ...e('subagent', 'claude', id), subagentId: id });
  const rows = chatRows([agent('a'), agent('b'), agent('c'), e('message', 'claude', 'Waiting on them.'), agent('d')]);
  assert.deepEqual(
    rows.map((r) => (r.kind === 'subagent' ? r.entries.map((x) => x.subagentId).join('+') : r.kind)),
    ['a+b+c', 'message', 'd'],
  );
});

test('plan changes logged back to back fold into one row; anything between them starts a new one', () => {
  const plan = (text: string) => e('event', 'harness', text);
  const burst = [plan('Claude dropped "Read theme code"'), plan('Codex dropped "Patch tokens"'), plan('Plan: Claude found 3 more steps'), plan('Plan: Claude added "Run tests"')];
  assert.deepEqual(shape([e('message', 'claude', 'Replanning.'), ...burst, e('event', 'harness', 'Scheduled run: nightly'), plan('Claude dropped "Ship"')]), [
    'Replanning.',
    'plan(Claude dropped "Read theme code", Codex dropped "Patch tokens", Plan: Claude found 3 more steps, Plan: Claude added "Run tests")',
    'Scheduled run: nightly',
    'plan(Claude dropped "Ship")',
  ]);
  assert.equal(planSummary(burst), 'Plan updated: dropped 2 steps, added 4 steps');
  assert.equal(planSummary(burst.slice(2, 3)), 'Plan updated: added 3 steps');
  assert.deepEqual(shape([e('event', 'you', 'Plan: Claude found 3 more steps')]), ['Plan: Claude found 3 more steps'], 'only the harness logs plan changes');
});
