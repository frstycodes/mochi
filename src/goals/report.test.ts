import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '../model.ts';
import type { State } from '../store/index.tsx';
import { threadsReducer } from '../store/threads.ts';
import { nextStep, showsVerdictCard } from './report.ts';

test('a met goal waits on opening a PR, then on its review, then on settling once merged', () => {
  assert.equal(nextStep([]), 'open-pr');
  assert.equal(nextStep(['closed']), 'open-pr');
  assert.equal(nextStep(['draft']), 'review');
  assert.equal(nextStep(['merged', 'open']), 'review');
  assert.equal(nextStep(['merged', 'closed']), 'settle');
});

test('answering the next move keeps it in the chat as a record and hides the card until the next turn ends', () => {
  const t = { id: 't', goal: 'Ship it', status: 'running', steps: [], activity: [], prs: [], idle: { at: 5, accepted: [] } } as unknown as Thread;
  const state = { now: 6, threads: [t], checkpoints: { t: [] }, checkpointSeq: 0 } as unknown as State;
  assert.equal(showsVerdictCard(t), true);
  const record = { summary: 'Added the limiter.', question: 'Open a PR?', answer: 'Open pull request' };
  const [after] = threadsReducer(state, { type: 'next-move-record', threadId: 't', record }).threads;
  assert.equal(showsVerdictCard(after), false);
  assert.deepEqual(after.activity.at(-1)?.nextMove, record);
});

test('without a goal, a reported turn still ends in the next-move card, and the next turn brings it back after an answer', () => {
  const t = { id: 't', goal: '', status: 'running', steps: [], activity: [], prs: [], report: { at: 5, by: 'claude', decisions: [], left: [], next: 'Commit it?', options: [{ label: 'Commit', reply: 'Commit it.' }] } } as unknown as Thread;
  const at = (now: number, s: Thread) => ({ now, threads: [s], checkpoints: { t: [] }, checkpointSeq: 0 }) as unknown as State;
  assert.equal(showsVerdictCard(t), true);
  const [answered] = threadsReducer(at(6, t), { type: 'next-move-record', threadId: 't', record: { question: 'Commit it?', answer: 'Not now' } }).threads;
  assert.equal(showsVerdictCard(answered), false);
  const reported = { ...answered, report: { ...t.report!, at: 9 } };
  const [idle] = threadsReducer(at(10, reported), { type: 'idle-start', threadId: 't' }).threads;
  assert.equal(showsVerdictCard(idle), true);
});
