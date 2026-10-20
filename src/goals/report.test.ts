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
