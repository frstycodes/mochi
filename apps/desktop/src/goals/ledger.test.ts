import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Assumption, Thread } from '../model.ts';
import type { State } from '../store/index.tsx';
import { threadsReducer } from '../store/threads.ts';
import { corrected, withCorrections } from './ledger.ts';
import { moveRecord } from './report.ts';

const open = (id: string, text: string, step?: number): Assumption => ({
  id,
  text,
  turn: 1,
  state: 'open',
  ...(step && { step }),
});

test('a correction needs new words: the same words, or none, put the assumption back to open', () => {
  const ledger = [open('a1', 'The window resets on the minute', 2)];
  const changed = corrected(ledger, 'a1', ' The window is rolling ');
  assert.deepEqual(changed?.[0], {
    ...ledger[0],
    state: 'changed',
    correction: 'The window is rolling',
  });
  assert.deepEqual(
    corrected(changed, 'a1', 'The window resets on the minute'),
    ledger,
  );
  assert.deepEqual(corrected(changed, 'a1', undefined), ledger);
});

test('corrections go at the top of the next message, with their step and the words they replace', () => {
  const ledger = corrected(
    [
      open('a1', 'The window resets on the minute', 2),
      open('a2', 'Bursts above 20 a second are abuse'),
      open('a3', 'Staging shares the limits', 3),
    ],
    'a1',
    'The window is rolling',
  );
  const both = corrected(ledger, 'a2', 'Bursts above 50 a second are abuse');
  assert.equal(
    withCorrections(both, 'Commit'),
    'Corrections to your assumptions\n\n- Step 2: The window is rolling (not: The window resets on the minute)\n- Bursts above 50 a second are abuse (not: Bursts above 20 a second are abuse)\n\nCommit',
  );
  assert.equal(withCorrections([open('a1', 'x')], 'Commit'), 'Commit');
});

test("sending carries the corrections once and accepts the turn's assumptions you left alone, not older ones", () => {
  const thread = {
    id: 't',
    status: 'review',
    steps: [],
    activity: [],
    prs: [],
    idle: { at: 5, turn: 2 },
    report: {
      at: 5,
      turn: 2,
      by: 'claude',
      recap: 'Done.',
      decisions: [],
      ask: 'Commit?',
      actions: [{ label: 'Commit' }],
    },
    assumptions: [
      { ...open('a0', 'Older one'), turn: 1 },
      { ...open('a1', 'The window resets on the minute', 2), turn: 2 },
      { ...open('a2', 'Bursts above 20 a second are abuse'), turn: 2 },
    ],
  } as unknown as Thread;
  const state = {
    now: 6,
    threads: [thread],
    checkpoints: { t: [] },
    checkpointSeq: 0,
  } as unknown as State;
  const edited = threadsReducer(state, {
    type: 'assumption-correct',
    threadId: 't',
    id: 'a1',
    correction: 'The window is rolling',
  });
  assert.deepEqual(moveRecord(edited.threads[0], 'Commit?', 'Commit'), {
    summary: 'Done.',
    question: 'Commit?',
    answer: 'Commit · 1 accepted, 1 changed',
  });
  const sent = threadsReducer(edited, {
    type: 'send',
    threadId: 't',
    text: 'Commit',
  });
  const [after] = sent.threads;
  assert.equal(
    after.activity.at(-1)?.text,
    'Corrections to your assumptions\n\n- Step 2: The window is rolling (not: The window resets on the minute)\n\nCommit',
  );
  assert.deepEqual(
    after.assumptions?.map((a) => [a.id, a.state, !!a.isSent]),
    [
      ['a0', 'open', false],
      ['a1', 'changed', true],
      ['a2', 'accepted', false],
    ],
  );
  const [again] = threadsReducer(sent, {
    type: 'send',
    threadId: 't',
    text: 'And push',
  }).threads;
  assert.equal(again.activity.at(-1)?.text, 'And push', 'carried once');
});
