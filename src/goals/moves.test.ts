import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '../model.ts';
import { moveFor, questionFor } from './moves.ts';
import type { Gap, Verdict } from './verdict.ts';

const thread = (patch: Partial<Thread> = {}) => ({ idle: { at: 0, accepted: [] }, ...patch }) as Thread;
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
  assert.deepEqual(moveFor(thread(), verdict('needs-you', { chip: 'Your call' }), []), { kind: 'confirm', label: 'Mark done' }, 'what only you can check');
  assert.equal(moveFor(thread({ proposal: { state: 'waiting' } as Thread['proposal'] }), verdict('needs-you'), []), null, 'the proposal card above holds Accept');
  assert.equal(moveFor(thread(), verdict('stalled', { chip: 'Stopped' }), [])?.kind, 'continue');
  assert.equal(moveFor(thread(), verdict('stalled', { chip: 'Limit' }), []), null);
});

test("the question is the agent's for a finished or stopped turn, Mochi's where only Mochi can name the move", () => {
  const report = { at: 0, by: 'claude' as const, decisions: [], left: [], next: 'Commit the cookie fix and its test?' };
  assert.equal(questionFor(verdict('done'), { kind: 'commit', label: 'Commit' }, report, 'Claude'), 'Commit the cookie fix and its test?');
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
