import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LoggedEvent } from '@mochi/domain';
import type { QueueItem, Thread } from '../../../../src/model.ts';
import { autoSimplify, autoTitles, compactInstructions, delegatedReports, draftsPrune, idleChecks, limitResumes, prSync, queueRunner, react, subThreadWakes, type ReactorState } from './rules.ts';

const idle = { isWorking: false };
const thread = (id: string, fields: Record<string, unknown> = {}) =>
  ({ id, title: id, spaceId: 'space', status: 'running', goal: '', activity: [], providers: ['claude'], live: idle, ...fields }) as unknown as Thread;
const state = (threads: Thread[], queue: QueueItem[] = [], boot = 'b1'): ReactorState => ({ threads, queue, boot });
const event = (type: string, threadId: string | null, payload: unknown = null, sequence = 7): LoggedEvent => ({ sequence, type, threadId, payload });
const saved = (id = 't1') => event('thread.saved', id);
const NONE = state([]);

test('queue runner: sends the head of an idle thread queue, not one mid-turn or waiting on an approval', () => {
  const queued = [{ id: 'm1', draft: 'next' }, { id: 'm2', draft: 'later' }];
  assert.deepEqual(queueRunner(saved(), NONE, state([thread('t1', { queued })])), [{ type: 'queue.send', key: 'queue:m1', threadId: 't1', messageId: 'm1' }]);
  assert.deepEqual(queueRunner(saved(), NONE, state([thread('t1', { queued, live: { isWorking: true } })])), []);
  const approval = { id: 'q', threadId: 't1', kind: 'approval' } as unknown as QueueItem;
  assert.deepEqual(queueRunner(saved(), NONE, state([thread('t1', { queued })], [approval])), []);
});

test('delegated reports: one command per due report, keyed by thread and subagent', () => {
  const subagents = [{ id: 's1', isReportDue: true }, { id: 's2' }];
  assert.deepEqual(delegatedReports(saved(), NONE, state([thread('t1', { subagents })])), [{ type: 'delegate.report', key: 'report:t1:s1', threadId: 't1', subagentId: 's1' }]);
});

test('sub-thread wakes: an idle parent with notes and idle children wakes, once per set of notes', () => {
  const parent = (notes: string[]) => thread('p', { live: { isWorking: false, notes } });
  const child = (isWorking: boolean) => thread('c', { parent: { threadId: 'p' }, live: { isWorking } });
  const [first] = subThreadWakes(saved('c'), NONE, state([parent(['[Sub-thread "c" ended a turn: done]']), child(false)]));
  assert.equal(first?.type, 'subthread.wake');
  assert.equal(first?.threadId, 'p');
  assert.deepEqual(subThreadWakes(saved('c'), NONE, state([parent(['[Sub-thread "c" ended a turn: done]']), child(true)])), [], 'a working child holds the wake');
  const [second] = subThreadWakes(saved('c'), NONE, state([parent(['[Sub-thread "c" ended a turn: failed]']), child(false)]));
  assert.notEqual(second?.key, first?.key, 'new notes wake it again');
});

test('limit resumes: armed threads get a resume due at their reset, a new key per reset', () => {
  const armed = (resetsAt: string) => thread('t1', { live: { isWorking: false, limit: { autoResume: true, resetsAt } } });
  assert.deepEqual(limitResumes(saved(), NONE, state([armed('2026-10-25T00:00:00Z')])), [{ type: 'limit.resume', key: 'resume:t1:2026-10-25T00:00:00Z', threadId: 't1', resetsAt: '2026-10-25T00:00:00Z' }]);
  assert.deepEqual(limitResumes(saved(), NONE, state([thread('t1', { live: { isWorking: false, limit: { resetsAt: 'x' } } })])), [], 'not armed');
});

test('auto titles: after the first exchange, never after a rename', () => {
  const activity = [{ who: 'you', kind: 'message', text: 'add a readme to the repo' }, { who: 'claude', kind: 'message', text: 'Done.' }];
  const [command] = autoTitles(saved(), NONE, state([thread('t1', { activity })]));
  assert.equal(command?.type, 'title.generate');
  assert.equal(command?.key, 'title:t1');
  assert.ok(command?.type === 'title.generate' && command.prompt.includes('add a readme'));
  assert.deepEqual(autoTitles(saved(), NONE, state([thread('t1', { activity, isTitleRenamed: true })])), []);
  assert.deepEqual(autoTitles(saved(), NONE, state([thread('t1', { activity: activity.slice(0, 1) })])), [], 'no reply yet');
});

test('compact instructions: live Claude threads only, a new key when the goal changes or Core restarts', () => {
  const claude = (goal: string) => thread('t1', { goal, session: { provider: 'claude' } });
  const [first] = compactInstructions(saved(), NONE, state([claude('ship it')]));
  assert.equal(first?.type, 'compact.instructions');
  assert.equal(compactInstructions(saved(), NONE, state([claude('ship it')]))[0]?.key, first?.key, 'same goal, same key');
  assert.notEqual(compactInstructions(saved(), NONE, state([claude('ship it twice')]))[0]?.key, first?.key);
  assert.notEqual(compactInstructions(saved(), NONE, state([claude('ship it')], [], 'b2'))[0]?.key, first?.key);
  assert.deepEqual(compactInstructions(saved(), NONE, state([thread('t1', { session: { provider: 'codex' } })])), []);
});

test('idle checks and auto simplify: one command per turn end', () => {
  const end = event('agent.turn-end', 't1', { type: 'turn-end', status: 'done' }, 42);
  assert.deepEqual(idleChecks(end, NONE, NONE), [{ type: 'idle.gather', key: 'idle:42', threadId: 't1' }]);
  assert.deepEqual(autoSimplify(end, NONE, NONE), [{ type: 'simplify.auto', key: 'simplify:42', threadId: 't1' }]);
});

test('PR sync: a tool that pushes or opens a PR refreshes, other tools and tool ends do not', () => {
  const tool = (text: string, phase = 'start') => event('agent.tool', 't1', { type: 'tool', phase, text }, 9);
  assert.deepEqual(prSync(tool('git push -u origin HEAD'), NONE, NONE), [{ type: 'pr.refresh', key: 'pr:9', threadId: 't1' }]);
  assert.deepEqual(prSync(tool('gh pr create --fill'), NONE, NONE).length, 1);
  assert.deepEqual(prSync(tool('git status'), NONE, NONE), []);
  assert.deepEqual(prSync(tool('git push', 'end'), NONE, NONE), []);
});

test('drafts prune: only on thread delete', () => {
  assert.deepEqual(draftsPrune(event('thread.deleted', 't1'), NONE, NONE), [{ type: 'drafts.prune', key: 'drafts:t1', threadId: 't1' }]);
  assert.deepEqual(react(saved(), NONE, NONE), [], 'a save with no threads asks for nothing');
  assert.deepEqual(react(event('agent.text', 't1'), NONE, NONE), [], 'unregistered event types run no rule');
});
