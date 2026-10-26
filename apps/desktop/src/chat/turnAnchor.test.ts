import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry, Thread, TurnReport } from '../model.ts';
import { turnAnchor } from './turnAnchor.ts';

const e = (
  kind: ActivityEntry['kind'],
  who: ActivityEntry['who'],
  text: string,
  extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({ at: 0, who, kind, text, ...extra });
const you = (text: string) => e('message', 'you', text);
const reply = (text: string) => e('message', 'claude', text);
const edit = (path: string) => e('tool', 'claude', `Edit ${path}  +1 −0`);
const stopped = e('event', 'harness', 'Turn interrupted', {
  turnEnd: 'interrupted',
});
const failed = e('event', 'harness', 'Turn failed: boom', {
  turnEnd: 'failed',
});
const report = (index: number): TurnReport => ({
  at: 0,
  turn: 1,
  by: 'claude',
  decisions: [],
  left: [],
  summary: `report at ${index}`,
  index,
});

const thread = (
  activity: ActivityEntry[],
  isWorking: boolean,
  patch: Partial<Thread> = {},
) =>
  ({
    activity,
    steps: [],
    live: { isWorking },
    idle: { at: 0, turn: 1, accepted: [] },
    ...patch,
  }) as Thread;

// Turn one: your message, an edit, its report; the activity indices below follow it.
const firstTurn = [you('add charts'), edit('src/a.ts'), reply('Done.')];

test('the first turn anchors nothing while it runs, then itself once it ends', () => {
  assert.equal(turnAnchor(thread([you('add charts')], true)), undefined);
  const anchor = turnAnchor(thread(firstTurn, false, { report: report(3) }));
  assert.equal(anchor?.start, 0);
  assert.equal(anchor?.end, 2);
  assert.equal(anchor?.isLatest, true);
  assert.equal(anchor?.report?.summary, 'report at 3');
  assert.deepEqual(
    anchor?.changes?.files.map((f) => f.path),
    ['src/a.ts'],
  );
});

test('a running turn leaves the widgets on the completed turn before it, with its report and changes', () => {
  const anchor = turnAnchor(
    thread([...firstTurn, you('now the legend'), edit('src/b.ts')], true, {
      report: report(3),
    }),
  );
  assert.equal(anchor?.start, 0);
  assert.equal(anchor?.end, 2);
  assert.equal(anchor?.isLatest, false);
  assert.equal(anchor?.report?.summary, 'report at 3');
  assert.deepEqual(
    anchor?.changes?.files.map((f) => f.path),
    ['src/a.ts'],
  );
});

test("the running turn's own report doesn't move the anchor before that turn ends", () => {
  const anchor = turnAnchor(
    thread([...firstTurn, you('now the legend'), reply('Done.')], true, {
      report: report(5),
    }),
  );
  assert.equal(anchor?.start, 0);
  assert.equal(anchor?.report, undefined);
});

test('a completed turn takes the widgets over, even with no report or changes', () => {
  const activity = [...firstTurn, you('why?'), reply('Because.')];
  const anchor = turnAnchor(thread(activity, false, { report: report(5) }));
  assert.equal(anchor?.start, 3);
  assert.equal(anchor?.isLatest, true);
  assert.equal(anchor?.report?.summary, 'report at 5');
  assert.equal(anchor?.changes, undefined);
  const unreported = turnAnchor(thread(activity, false, { report: report(3) }));
  assert.equal(unreported?.start, 3);
  assert.equal(unreported?.report, undefined);
});

test('a stopped or failed turn with nothing of its own leaves the widgets on the turn before', () => {
  for (const end of [stopped, failed]) {
    const anchor = turnAnchor(
      thread([...firstTurn, you('now the legend'), end], false, {
        report: report(3),
      }),
    );
    assert.equal(anchor?.start, 0);
    assert.equal(anchor?.isLatest, false);
    assert.equal(anchor?.report?.summary, 'report at 3');
  }
});

test('a stopped turn takes the widgets over once it changed files or reported', () => {
  const edited = turnAnchor(
    thread(
      [...firstTurn, you('now the legend'), edit('src/b.ts'), stopped],
      false,
      { report: report(3) },
    ),
  );
  assert.equal(edited?.start, 3);
  assert.equal(edited?.isLatest, true);
  assert.equal(edited?.report, undefined);
  const reported = turnAnchor(
    thread([...firstTurn, you('now the legend'), stopped], false, {
      report: report(4),
    }),
  );
  assert.equal(reported?.start, 3);
});

test('several stopped turns in a row walk back to the last one with widgets, even while another runs', () => {
  const anchor = turnAnchor(
    thread(
      [...firstTurn, you('b'), stopped, you('c'), failed, you('d')],
      true,
      { report: report(3) },
    ),
  );
  assert.equal(anchor?.start, 0);
  assert.equal(anchor?.end, 2);
});

test('a report saved without its index belongs to the last ended turn when its turn number matches', () => {
  const legacy = { ...report(0), index: undefined };
  const anchor = turnAnchor(
    thread([...firstTurn, you('now the legend')], true, { report: legacy }),
  );
  assert.equal(anchor?.report, legacy);
});
