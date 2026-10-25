import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread, TurnReport } from '../model.ts';
import { agentAsk, continuePrompt, moveFor, questionFor, withUnseenGaps } from './moves.ts';
import type { Gap, Verdict } from './verdict.ts';

const thread = (patch: Partial<Thread> = {}) => ({ idle: { at: 0, accepted: [] }, repo: { project: 'app', branch: 'fix/x' }, ...patch }) as Thread;
const verdict = (kind: Verdict['kind'], patch: Partial<Verdict> = {}): Verdict => ({ kind, chip: '', tone: 'muted', reason: '', gaps: [], ...patch });
const gap = (id: string, isAccepted = false): Gap => ({ id, severity: 'critical', label: id, text: id, isAccepted });

test('a met goal moves commit → pull request → review → settle, from git and PR state', () => {
  assert.equal(moveFor(thread({ idle: { at: 0, accepted: [], uncommitted: 2 } }), verdict('done'), [])?.kind, 'commit');
  assert.equal(moveFor(thread(), verdict('done'), [])?.kind, 'open-pr');
  assert.equal(moveFor(thread(), verdict('done'), ['open']), null, 'a PR in review waits on GitHub');
  assert.equal(moveFor(thread(), verdict('done'), ['merged'])?.kind, 'settle');
});

test('gaps count only the ones you have not accepted; a question or a limit has no move', () => {
  assert.deepEqual(moveFor(thread(), verdict('gaps', { gaps: [gap('a'), gap('b', true)] }), []), { kind: 'close-gaps', label: 'Close 1 gap' });
  assert.equal(moveFor(thread(), verdict('needs-you'), []), null);
  assert.deepEqual(moveFor(thread({ repo: null }), verdict('needs-you', { chip: 'Your call' }), []), { kind: 'confirm', label: 'Verify outcome' }, 'what only you can check');
  assert.equal(moveFor(thread({ proposal: { state: 'waiting' } as Thread['proposal'] }), verdict('needs-you'), []), null, 'the proposal card above holds Accept');
  assert.equal(moveFor(thread(), verdict('stalled', { chip: 'Stopped' }), [])?.kind, 'continue');
  assert.equal(moveFor(thread(), verdict('stalled', { chip: 'Limit' }), []), null);
});

test("the question is the agent's for a finished or stopped turn, Mochi's where only Mochi can name the move", () => {
  const report = { at: 0, by: 'claude' as const, decisions: [], left: [], next: 'Commit the cookie fix and its test?' };
  assert.equal(questionFor(verdict('done'), { kind: 'commit', label: 'Commit' }, report, 'Claude'), 'Commit these changes?');
  assert.equal(questionFor(verdict('done'), { kind: 'commit', label: 'Commit' }, undefined, 'Claude'), 'Commit these changes?');
  assert.equal(questionFor(verdict('gaps', { gaps: [gap('a'), gap('b')] }), { kind: 'close-gaps', label: 'Close 2 gaps' }, report, 'Claude'), 'Hand the 2 gaps back to Claude?', "the agent doesn't know Mochi's gaps");
  assert.equal(questionFor(verdict('needs-you', { reason: 'Retry or quarantine?' }), null, report, 'Claude'), 'Retry or quarantine?');
  assert.equal(questionFor(verdict('stalled', { chip: 'Limit' }), null, report, 'Claude'), null, 'a limit waits on the clock');
});

test('a parent acts on the sub-thread that holds it up; a finished sub-thread is handed back, then merged', () => {
  const sub = (kind: Verdict['kind'], openGaps = 0) => verdict('needs-you', { subThread: { id: 'c', title: 'Docs', kind, openGaps } });
  assert.deepEqual(moveFor(thread(), sub('gaps', 2), []), { kind: 'close-gaps', label: 'Close 2 gaps', threadId: 'c' });
  assert.deepEqual(moveFor(thread(), sub('done'), []), { kind: 'hand-back', label: 'Hand back', threadId: 'c' });
  assert.equal(moveFor(thread(), sub('stalled'), []), null, 'a stalled sub-thread waits on its own card');
  assert.deepEqual(moveFor(thread(), verdict('done'), [], { subPrs: [141, 142] }), { kind: 'merge-subs', label: 'Merge 2 PRs' });
  assert.equal(questionFor(sub('gaps', 1), { kind: 'close-gaps', label: 'Close 1 gap', threadId: 'c' }, undefined, 'Claude'), 'Docs has a gap: hand it back to its agent?');
});

test("a sub-thread's own card opens its PR into the parent's branch, then hands back, then waits", () => {
  const child = (handedBackAt?: number) => thread({ parent: { threadId: 'p', ...(handedBackAt && { handedBackAt }) } });
  const parent = { title: 'Rate limiting', repo: { project: 'app', branch: 'feat/limits' } };
  assert.equal(questionFor(verdict('done'), moveFor(child(), verdict('done'), [], { parent }), undefined, 'Claude', { parent }), 'Open a pull request into feat/limits?');
  assert.deepEqual(moveFor(child(), verdict('done'), ['open'], { parent }), { kind: 'hand-back', label: 'Hand back' });
  assert.equal(moveFor(child(5), verdict('done'), ['open'], { parent }), null, 'handed back: the parent merges it');
});


test('unverified human criteria do not hide commit or a missing PR', () => {
  const v = verdict('needs-you', { chip: 'Your call', reason: 'Did this get you what you wanted?' });
  const repo = { project: 'app', branch: 'fix/cookies' };
  assert.equal(moveFor(thread({ repo, idle: { at: 0, accepted: [], uncommitted: 2 } }), v, [])?.kind, 'commit');
  const move = moveFor(thread({ repo }), v, []);
  assert.equal(move?.kind, 'open-pr');
  const report = { at: 0, by: 'claude' as const, decisions: [], left: [], next: 'Mark this done?' };
  assert.equal(questionFor(v, move, report, 'Claude'), 'Open a pull request for this?');
  assert.equal(moveFor(thread({ repo: null }), v, [])?.kind, 'confirm');
});


test('folderless work offers verification or settling, never a pull request', () => {
  const t = thread({ repo: null, criteria: [{ id: 'a', text: 'Summary delivered' }] });
  const move = moveFor(t, verdict('done'), []);
  assert.equal(move?.kind, 'confirm');
  assert.equal(questionFor(verdict('done'), move, undefined, 'Codex'), 'Verify the completed work against the goal criteria?');
  assert.equal(moveFor({ ...t, idle: { at: 0, accepted: [], isConfirmed: true } }, verdict('done'), [])?.kind, 'settle');
});

test("Continue sends a yes to the agent's own next move, and only resumes when it proposed none", () => {
  const report: TurnReport = { at: 0, by: 'claude', decisions: [], left: [], next: 'Rebuild Mochi and start a test task?' };
  assert.equal(continuePrompt(report, true), 'Yes: Rebuild Mochi and start a test task?');
  assert.equal(continuePrompt(undefined, true), 'Continue the plan from where you stopped.');
  assert.equal(continuePrompt(undefined, false), 'Continue where you left off.');
});

test("the agent's own question and buttons replace Mochi's move; without buttons, Mochi's move stays", () => {
  const options = [{ label: 'Commit', reply: 'Commit the cookie fix.' }];
  const report: TurnReport = { at: 0, by: 'claude', decisions: [], left: [], next: 'Commit the cookie fix?', options };
  assert.deepEqual(agentAsk(report), { question: 'Commit the cookie fix?', options });
  assert.equal(agentAsk({ ...report, options: undefined }), null);
  assert.equal(agentAsk({ ...report, next: undefined }), null);
  assert.equal(agentAsk(undefined), null);
});

test("Close gaps joins the agent's buttons for gaps its report predates: first when critical, last when only unverified", () => {
  const report: TurnReport = { at: 10, by: 'claude', decisions: [], left: [] };
  const criterion = (id: string, at: number) => ({ id, text: id, command: 'pnpm test', check: { status: 'failed' as const, at } });
  const t = thread({ criteria: [criterion('old', 5), criterion('new', 12)] });
  const labels = (gaps: Gap[]) => withUnseenGaps(['Open PR'], t, verdict('gaps', { gaps }), report, (m) => m.label);
  const failed = (id: string): Gap => ({ ...gap(`check-${id}`), criterionId: id });
  assert.deepEqual(labels([failed('old')]), ['Open PR'], 'it failed before the report, so the agent knew');
  assert.deepEqual(labels([failed('new')]), ['Close 1 gap', 'Open PR'], 'it failed after the report');
  assert.deepEqual(labels([gap('ci-1')]), ['Close 1 gap', 'Open PR'], 'CI comes from GitHub after the report');
  assert.deepEqual(labels([{ ...gap('unverified-0'), severity: 'unverified' }]), ['Open PR', 'Close 1 gap'], "the audit's unverified claims go last");
  assert.deepEqual(labels([failed('new'), failed('old')]), ['Close 2 gaps', 'Open PR'], 'Close gaps sends every open gap');
  assert.deepEqual(labels([{ ...failed('new'), isAccepted: true }]), ['Open PR'], 'an accepted gap is settled');
});
