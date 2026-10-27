import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Step, Thread, TurnReport } from '../model.ts';
import type { State } from '../store/index.tsx';
import { threadsReducer } from '../store/threads.ts';
import { changeDraft, reportItems, withAssumptions } from './ledger.ts';
import { reportHeadline } from './report.ts';
import { spineNodes, turnSection } from './spineNodes.ts';

const step = (title: string, status: Step['status'], at = 10): Step => ({
  id: title,
  title,
  status,
  addedAt: at,
  addedBy: 'claude',
});

const REPORT: TurnReport = {
  at: 12,
  turn: 2,
  index: 1,
  by: 'claude',
  decisions: [
    'Kept the parser',
    { text: 'Used the csv helper', step: 'fix quoted fields' },
  ],
  assumptions: [
    { text: 'Assumed timestamps are UTC', step: 'Read the format' },
    { text: 'Assumed amounts are cents', step: 'No such step' },
  ],
  left: [],
};

function thread(extra: Partial<Thread> = {}): Thread {
  return {
    id: 't',
    goal: '',
    status: 'review',
    prs: [],
    activity: [{ at: 9, who: 'you', kind: 'message', text: 'Import the CSV' }],
    steps: [
      step('Read the format', 'done'),
      step('Patch the parser', 'dropped'),
      step('Fix quoted fields', 'done'),
      step('Backfill', 'ready'),
    ],
    pivots: [
      {
        why: 'The crash is in the tokenizer',
        dropped: ['Patch the parser'],
        at: 1,
        turn: 2,
      },
      { why: 'Last turn', dropped: ['Old'], at: 0, turn: 1 },
    ],
    assumptions: withAssumptions([], reportItems(REPORT.assumptions), 2),
    idle: { at: 12, turn: 2, accepted: [] },
    report: REPORT,
    ...extra,
  } as unknown as Thread;
}

test('the spine is the plan with the turn pivots in place and each item on the step it names, else the last', () => {
  assert.deepEqual(spineNodes(thread(), REPORT), [
    {
      kind: 'step',
      title: 'Read the format',
      status: 'done',
      items: [{ kind: 'assumption', id: 'a1' }],
    },
    {
      kind: 'pivot',
      why: 'The crash is in the tokenizer',
      dropped: ['Patch the parser'],
    },
    {
      kind: 'step',
      title: 'Fix quoted fields',
      status: 'done',
      items: [{ kind: 'decision', text: 'Used the csv helper' }],
    },
    {
      kind: 'step',
      title: 'Backfill',
      status: 'pending',
      items: [
        { kind: 'decision', text: 'Kept the parser' },
        { kind: 'assumption', id: 'a2' },
      ],
    },
  ]);
});

test('a turn that touched no step and changed no plan has no spine: the card falls back to rows', () => {
  const t = thread({
    steps: [step('Read the format', 'done', 1)],
    pivots: [],
  });
  assert.equal(spineNodes(t, REPORT), null);
  const rows = turnSection(t, REPORT, true);
  assert.equal(rows?.kind, 'rows');
  assert.deepEqual(rows?.kind === 'rows' && rows.decisions, [
    'Kept the parser',
    'Used the csv helper',
  ]);
});

test('with the turn spine off the card shows no section and the sidebar no assumptions', () => {
  const t = thread();
  assert.equal(turnSection(t, REPORT, false), null);
  assert.equal(turnSection(t, REPORT, true)?.kind, 'spine');
  assert.equal(reportHeadline(t, true), '2 assumptions to check');
  assert.notEqual(reportHeadline(t, false), '2 assumptions to check');
});

test('the sidebar puts the question before the assumptions to check', () => {
  const t = thread({ report: { ...REPORT, question: 'Commit it?' } });
  assert.equal(reportHeadline(t, true), 'Needs you: Commit it?');
});

const state = (t: Thread) =>
  ({
    threads: [t],
    now: 20,
    checkpoints: { t: [] },
    checkpointSeq: 0,
  }) as unknown as State;
const reduce = (s: State, action: unknown) =>
  threadsReducer(s, action as never);

test('Accept answers an assumption; Change marks it only once you send the drafted message', () => {
  let s = state(thread());
  const [a1, a2] = s.threads[0].assumptions!;
  s = reduce(s, {
    type: 'assumption-set',
    threadId: 't',
    id: a1.id,
    state: 'accepted',
  });
  s = reduce(s, {
    type: 'send',
    threadId: 't',
    text: 'Something else',
    reason: '',
  });
  assert.deepEqual(
    s.threads[0].assumptions!.map((a) => a.state),
    ['accepted', 'open'],
    'a message Change did not draft changes nothing',
  );
  s = reduce(s, {
    type: 'send',
    threadId: 't',
    text: `${changeDraft(a2)}they are dollars`,
    reason: '',
  });
  assert.deepEqual(
    s.threads[0].assumptions!.map((a) => a.state),
    ['accepted', 'changed'],
  );
});

test('a pivot keeps only its turn, and a why alone fills the last one that lacks it', () => {
  let s = state(thread({ pivots: [{ dropped: ['Old'], at: 0, turn: 1 }] }));
  s = reduce(s, {
    type: 'pivot',
    threadId: 't',
    pivot: { dropped: ['Patch'], at: 1 },
  });
  assert.deepEqual(s.threads[0].pivots, [
    { dropped: ['Patch'], at: 1, turn: 3 },
  ]);
  s = reduce(s, { type: 'pivot-why', threadId: 't', why: 'Tokenizer' });
  assert.equal(s.threads[0].pivots?.[0].why, 'Tokenizer');
});
