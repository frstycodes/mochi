import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bareState, type RefState } from '../chat/refs.ts';
import type { Criterion, Step, Thread } from '../model.ts';
import { failureLine, idleVerdict, verdictTiles } from './verdict.ts';

const met = (id: string, command?: string): Criterion => ({ id, text: id, command, check: { status: 'passed', at: 1 } });
const failed = (id: string, command: string): Criterion => ({ id, text: id, command, check: { status: 'failed', at: 1, output: '5 failed' } });
const step = (id: string, status: Step['status']) => ({ id, title: id, status }) as Step;
const pr = (status: RefState['status'], extra: Partial<RefState> = {}): RefState => ({ ...bareState('pr', status, 'PR', 'https://github.com/o/r/pull/135'), ...extra });

const thread = (t: Partial<Thread> = {}) =>
  ({ id: 't', goal: 'Ship it', repo: { project: 'harness', branch: 'fix/x' }, status: 'running', steps: [], criteria: [met('a'), met('b')], activity: [], prs: [], live: { isWorking: false }, ...t }) as Thread;

test('a working thread has no verdict', () => {
  assert.equal(idleVerdict(thread({ live: { isWorking: true } }), []), null);
});

test('every criterion met reads done, and names what comes next from the PR', () => {
  assert.deepEqual(pick(idleVerdict(thread(), [])), ['done', 'Done', 'Open pull request']);
  assert.deepEqual(pick(idleVerdict(thread(), [pr('open')])), ['done', 'Done', 'In review · #135']);
  assert.deepEqual(pick(idleVerdict(thread(), [pr('merged')])), ['done', 'Merged', 'Settle thread']);
});

test('a failing check is a critical gap even when the agent claimed the criterion', () => {
  const claimed = { ...failed('tests', 'pnpm test'), claim: { evidence: 'all pass', at: 1, by: 'claude' as const } };
  const v = idleVerdict(thread({ criteria: [met('a'), claimed] }), [])!;
  assert.deepEqual(pick(v), ['gaps', '1 gap', 'Tests failing']);
  assert.equal(v.tone, 'destructive');
  assert.equal(v.gaps[0].severity, 'critical');
});

test('the #135 turn: failing tests plus two admissions read 3 gaps, critical first', () => {
  const audit = { unverified: [{ text: 'Not checked in app', quote: "I haven't checked it in the app" }, { text: 'Root cause not confirmed', quote: "I haven't confirmed it's what broke your #133 chip" }] };
  const v = idleVerdict(thread({ criteria: [met('a'), met('b'), failed('c', 'pnpm test')], idle: { at: 1, accepted: [], audit } }), [pr('open', { checks: 'pending' })])!;
  assert.deepEqual(pick(v), ['gaps', '3 gaps', 'Tests failing · Not checked in app · Root cause not confirmed']);
  assert.deepEqual(
    v.gaps.map((g) => g.severity),
    ['critical', 'unverified', 'unverified'],
  );
});

test('unverified-only gaps are amber; accepting them all leaves the thread done', () => {
  const audit = { unverified: [{ text: 'Not checked with reduced motion', quote: 'q' }] };
  const v = idleVerdict(thread({ idle: { at: 1, accepted: [], audit } }), [])!;
  assert.deepEqual([v.kind, v.tone], ['gaps', 'warning']);
  const accepted = idleVerdict(thread({ idle: { at: 1, accepted: [v.gaps[0].id], audit } }), [])!;
  assert.equal(accepted.kind, 'done');
  assert.equal(accepted.gaps[0].isAccepted, true, 'an accepted gap stays listed');
});

test('failing CI and conflicts on an open PR are critical; a merged PR has none', () => {
  assert.deepEqual(pick(idleVerdict(thread(), [pr('open', { checks: 'fail', hasConflicts: true })])), ['gaps', '2 gaps', 'CI failing · Conflicts']);
  assert.equal(idleVerdict(thread(), [pr('merged', { checks: 'fail' })])!.kind, 'done');
});

test('the reason line names three gaps, then counts the rest', () => {
  const criteria = ['pnpm test', 'vp check', 'tsc -b', 'pnpm e2e', 'pnpm build'].map((c, i) => failed(`c${i}`, c));
  assert.equal(idleVerdict(thread({ criteria }), [])!.reason, 'Tests failing · Lint failing · Types failing · 2 more');
});

test('a question beats gaps: in the tray, or asked in prose', () => {
  const criteria = [failed('c', 'pnpm test')];
  assert.deepEqual(pick(idleVerdict(thread({ criteria, status: 'needs-you' }), [])), ['needs-you', 'Question', 'Waiting on your answer']);
  const audit = { question: 'Retry or quarantine the test?', unverified: [] };
  assert.deepEqual(pick(idleVerdict(thread({ criteria, idle: { at: 1, accepted: [], audit } }), [])), ['needs-you', 'Question', 'Retry or quarantine the test?']);
});

test('a limit or a failed turn reads stalled before anything else', () => {
  assert.deepEqual(pick(idleVerdict(thread({ status: 'needs-you', live: { isWorking: false, limit: { label: 'Weekly' } } }), [])), ['stalled', 'Limit', 'Weekly limit']);
  const activity = [{ at: 1, who: 'harness' as const, kind: 'event' as const, text: 'Turn failed: Claude Code exited with code 1' }];
  assert.deepEqual(pick(idleVerdict(thread({ queuePause: 'failed', activity }), [])), ['stalled', 'Error', 'Claude Code exited with code 1']);
});

test('stopping with criteria unmet and nothing asked reads stalled, naming the next step', () => {
  const v = idleVerdict(thread({ criteria: [met('a'), { id: 'b', text: 'b' }], steps: [step('Wire the list', 'done'), step('Add the empty state', 'ready')] }), []);
  assert.deepEqual(pick(v), ['stalled', 'Stopped', 'Stopped before "Add the empty state", asked nothing']);
});

test('a chat with no goal is plainly idle', () => {
  assert.deepEqual(pick(idleVerdict(thread({ goal: '', criteria: [] }), [])), ['idle', 'Idle', 'Idle']);
});

function pick(v: ReturnType<typeof idleVerdict>) {
  return v && [v.kind, v.chip, v.reason];
}

test('the evidence strip reads the #135 turn: a failing check, an open PR with CI running, two admissions', () => {
  const audit = { unverified: [{ text: 'Not checked in app', quote: 'q1' }, { text: 'Root cause not confirmed', quote: 'q2' }] };
  const t = thread({ repo: { project: 'harness', branch: 'fix/x' }, criteria: [met('a'), met('b', 'vp check'), failed('c', 'pnpm test')], idle: { at: 1, accepted: [], audit, uncommitted: 0 } });
  const prs = [pr('open', { checks: 'pending' })];
  const tiles = verdictTiles(t, prs, idleVerdict(t, prs)!);
  assert.deepEqual(
    tiles.map((x) => [x.name, x.value, x.tone ?? '']),
    [
      ['Criteria', '2 of 3', ''],
      ['Checks', '1 failing', 'destructive'],
      ['Git', 'pushed', ''],
      ['PR #135', 'CI running', ''],
      ['Agent said', '2 unverified', 'warning'],
    ],
  );
  assert.deepEqual(tiles[1].bars, ['success', 'destructive']);
});

test("a failed check is summed up by its error line, not Node's trailing version line", () => {
  const output = 'node:internal/modules/run_main:107\n    triggerUncaughtException(\n\nAssertionError [ERR_ASSERTION]: -1 == 5\n    at file:///sum.test.mjs:3:8\n\nNode.js v26.0.0';
  assert.equal(failureLine(output), 'AssertionError [ERR_ASSERTION]: -1 == 5');
  assert.equal(failureLine('exit 2\nsomething odd'), 'something odd');
  assert.equal(failureLine(undefined), undefined);
});

test("a question from an earlier turn's report is answered: once you replied and the agent went idle again, it no longer reads Needs you", () => {
  const report = { by: 'claude' as const, decisions: [], left: [], question: 'Commit it as fix(sum)?', at: 862 };
  assert.deepEqual(pick(idleVerdict(thread({ report, idle: { at: 862, accepted: [] } }), [])), ['needs-you', 'Question', 'Commit it as fix(sum)?'], 'asked this turn');
  assert.deepEqual(pick(idleVerdict(thread({ report, idle: { at: 864, accepted: [], audit: { unverified: [] } } }), [])), ['done', 'Done', 'Open pull request']);
});

const judged = (id: string): Criterion => ({ id, text: id });
const claim = { evidence: 'all pass', at: 1, by: 'claude' as const };

test('a folderless lookup whose drafted criteria nobody can check reads Your call, not Stopped, and shows only the facts that apply', () => {
  const benq = thread({ repo: null, criteria: [judged('Order found'), judged('Current location reported'), judged('Delivery date given')], idle: { at: 1, accepted: [] } });
  const v = idleVerdict(benq, [])!;
  assert.deepEqual(pick(v), ['needs-you', 'Your call', 'Did this get you what you wanted?']);
  assert.deepEqual(verdictTiles(benq, [], v).map((x) => [x.name, x.value]), [['Criteria', '0 of 3']], 'no Git, PR or Checks without a folder or commands; no Agent said when nothing was read');
  const confirmed = idleVerdict({ ...benq, idle: { at: 1, accepted: [], isConfirmed: true } }, [])!;
  assert.deepEqual(pick(confirmed), ['done', 'Done', 'Nothing left open']);
});

test('a goal with no criteria and nothing open is your call, never "every criterion met"', () => {
  assert.deepEqual(pick(idleVerdict(thread({ criteria: [] }), [])), ['needs-you', 'Your call', 'Did this get you what you wanted?']);
});

test('stopped needs evidence: an open plan item, or the agent saying work is left', () => {
  const report = { by: 'claude' as const, decisions: [], left: ['Wire the empty state'], at: 2 };
  assert.deepEqual(pick(idleVerdict(thread({ criteria: [judged('b')], report, idle: { at: 2, accepted: [] } }), [])), ['stalled', 'Stopped', 'Stopped with "Wire the empty state" left, asked nothing']);
});

test("a criterion with a command isn't met on the agent's word: unchecked, it's a gap you can accept", () => {
  const unchecked = { id: 'tests', text: 'pnpm test passes', command: 'pnpm test', claim };
  const t = thread({ criteria: [met('a'), unchecked], idle: { at: 1, accepted: [], audit: { unverified: [] } } });
  const v = idleVerdict(t, [])!;
  assert.deepEqual(pick(v), ['gaps', '1 gap', 'Not checked']);
  assert.equal(verdictTiles(t, [], v).find((x) => x.id === 'agent')?.value, 'nothing open', "a check that never ran isn't something the agent admitted");
  assert.equal(idleVerdict(thread({ criteria: [met('a'), unchecked], idle: { at: 1, accepted: [v.gaps[0].id] } }), [])!.kind, 'done');
  assert.equal(idleVerdict(thread({ criteria: [met('a'), { ...unchecked, check: { status: 'passed', at: 1 } }] }), [])!.kind, 'done');
});

test('a parent with a sub-thread out waits quietly, and its covered criterion is no gap meanwhile', () => {
  const covered = { id: 'load', text: 'Holds 2k req/s', command: 'k6 run load.js' };
  const parent = thread({ criteria: [met('a'), covered] });
  const child = thread({ id: 'c', parent: { threadId: 't', criterionId: 'load' }, live: { isWorking: true } });
  const v = idleVerdict(parent, [], [{ thread: child, verdict: null }])!;
  assert.deepEqual([v.kind, v.reason, v.tone], ['waiting', 'Waiting on 1 sub-thread', 'muted']);
  assert.equal(v.gaps.length, 0);
});

test('a sub-thread that needs you, or finished and waits to be handed back, makes its parent need you', () => {
  const parent = thread({ criteria: [met('a')] });
  const child = thread({ id: 'c', title: 'Docs', parent: { threadId: 't' } });
  const gapsVerdict = { kind: 'gaps' as const, chip: '1 gap', tone: 'warning' as const, reason: 'Not checked', gaps: [{ id: 'g', severity: 'unverified' as const, label: 'x', text: 'x', isAccepted: false }] };
  const asks = idleVerdict(parent, [], [{ thread: child, verdict: gapsVerdict }])!;
  assert.deepEqual([asks.kind, asks.reason, asks.subThread], ['needs-you', 'Docs: Not checked', { id: 'c', title: 'Docs', kind: 'gaps', openGaps: 1 }]);
  const finished = idleVerdict(parent, [], [{ thread: child, verdict: { ...gapsVerdict, kind: 'done', gaps: [] } }])!;
  assert.equal(finished.reason, 'Docs is finished: hand it back');
  const handedBack = { ...child, parent: { threadId: 't', handedBackAt: 5 } };
  assert.equal(idleVerdict(parent, [], [{ thread: handedBack, verdict: { ...gapsVerdict, kind: 'done', gaps: [] } }])!.kind, 'done', 'once handed back it no longer holds the parent');
});


test('completed criteria cannot hide unfinished plan items or reported work', () => {
  assert.equal(idleVerdict(thread({ steps: [step('Open the PR', 'ready')] }), [])?.kind, 'stalled');
  assert.equal(idleVerdict(thread({ report: { at: 1, by: 'codex', decisions: [], left: ['Check the preview'] }, idle: { at: 1, accepted: [] } }), [])?.kind, 'stalled');
});

test('evidence distinguishes work done from verified criteria', () => {
  const t = thread({ criteria: [{ id: 'a', text: 'a', claim }, met('b')] });
  assert.deepEqual(verdictTiles(t, [], idleVerdict(t, [])!)[0].bars, ['info', 'success']);
});
