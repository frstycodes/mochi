import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { PROPOSAL_TTL, type ActivityEntry, type Thread } from '../model.ts';
import {
  answersOf,
  decisionsOf,
  NO_MARKS,
  proposalsOf,
  toggledMarks,
} from './logbook.ts';

const you = (at: number, text: string): ActivityEntry => ({
  at,
  who: 'you',
  kind: 'message',
  text,
});
const reply = (at: number, text: string): ActivityEntry => ({
  at,
  who: 'claude',
  kind: 'message',
  text,
});
const record = (
  at: number,
  input: Record<string, unknown>,
  extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({
  at,
  who: 'claude',
  kind: 'tool',
  text: 'Mcp mochi: record_answer',
  mcp: { server: 'mochi', tool: 'record_answer' },
  input,
  ...extra,
});
const qa = { question: 'How does expiry work?', summary: 'Computed on read.' };

test('a recorded answer links to the last reply of its turn', () => {
  const activity = [
    you(1, 'how does expiry work'),
    reply(2, 'Looking.'),
    record(2, qa),
    reply(3, 'It is computed on read.'),
    you(4, 'thanks'),
    reply(5, 'Welcome.'),
  ];
  assert.deepEqual(answersOf({ activity }), [
    { key: '2:2', ...qa, at: 2, index: 3, isSaved: false },
  ]);
});

test('failed calls, other servers and malformed input record nothing', () => {
  const activity = [
    you(1, 'q'),
    record(2, qa, { isError: true }),
    record(2, qa, { mcp: { server: 'linear', tool: 'record_answer' } }),
    record(2, { question: 'only a question' }),
    reply(3, 'a'),
  ];
  assert.deepEqual(answersOf({ activity }), []);
});

test('saving a reply takes its question from your prompt, and saving again removes it', () => {
  const activity = [you(1, '  why   two\nstores? '), reply(2, 'Because.')];
  const saved = toggledMarks({ activity }, NO_MARKS, 1);
  assert.deepEqual(answersOf({ activity }, saved), [
    {
      key: '1:2',
      question: 'why two stores?',
      summary: 'Because.',
      at: 2,
      index: 1,
      isSaved: true,
    },
  ]);
  assert.deepEqual(toggledMarks({ activity }, saved, 1), NO_MARKS);
});

test('removing a recorded answer hides it, and a save on its reply is not listed twice', () => {
  const activity = [you(1, 'q'), record(2, qa), reply(3, 'a')];
  assert.equal(
    answersOf({ activity }, { saved: ['2:3'], hidden: [] }).length,
    1,
  );
  const hidden = toggledMarks({ activity }, NO_MARKS, 2);
  assert.deepEqual(hidden, { saved: [], hidden: ['1:2'] });
  assert.deepEqual(answersOf({ activity }, hidden), []);
});

test('a save whose entry a rewind replaced is dropped', () => {
  const activity = [you(1, 'q'), reply(9, 'a different reply')];
  assert.deepEqual(answersOf({ activity }, { saved: ['1:2'], hidden: [] }), []);
});

test('decisions and assumptions come from plan records, with your correction as the text', () => {
  const thread: Pick<Thread, 'activity' | 'assumptions'> = {
    activity: [
      you(1, 'do it'),
      reply(2, 'Done.'),
      {
        at: 2,
        who: 'harness',
        kind: 'event',
        text: 'Plan',
        planRecord: {
          steps: [],
          decisions: [{ text: 'Derived, not stored' }],
          assumptionIds: ['a1', 'gone'],
        },
      },
    ],
    assumptions: [
      {
        id: 'a1',
        text: 'Assumed UTC',
        turn: 1,
        state: 'changed',
        correction: 'Local time',
      },
    ],
  };
  assert.deepEqual(
    decisionsOf(thread).map((d) => [d.kind, d.text, d.isCorrected, d.index]),
    [
      ['decision', 'Derived, not stored', false, 1],
      ['assumption', 'Local time', true, 1],
    ],
  );
});

test('deferred work is the pending, expired and dismissed proposals only', () => {
  const proposal = (id: string, state: 'pending' | 'started' | 'dismissed') =>
    ({
      id,
      title: id,
      brief: 'b',
      state,
      initiation: 'own_initiative',
    }) as never;
  const activity: ActivityEntry[] = [
    you(1, 'go'),
    {
      at: 1,
      who: 'harness',
      kind: 'event',
      text: '',
      proposals: [
        proposal('p1', 'pending'),
        proposal('p2', 'started'),
        proposal('p3', 'dismissed'),
      ],
    },
    reply(2, 'Done.'),
  ];
  const states = (now: number) =>
    proposalsOf({ activity }, now).map((p) => [p.key, p.state, p.index]);
  assert.deepEqual(states(2), [
    ['p1', 'pending', 2],
    ['p3', 'dismissed', 2],
  ]);
  assert.deepEqual(states(1 + PROPOSAL_TTL)[0], ['p1', 'expired', 2]);
});
